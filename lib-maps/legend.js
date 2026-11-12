// legend.js
// Handles drawing the key scale and indicators for the map legend

export function drawKeyScale({ keyscale, breaks, colour, config, window, state }) {
    keyscale.selectAll('*').remove();

    const changeDisplayKeyMap = {
        legendFormat: ['changeLegendFormat', 'changeFormat'],
        legendPrefix: ['changeLegendPrefix', 'changePrefix'],
        legendSuffix: ['changeLegendSuffix', 'changeSuffix']
    };

    if (!Array.isArray(breaks) || breaks.length < 2 || breaks.some(d => typeof d !== 'number' || !Number.isFinite(d))) {
        console.error(
            "[Map Config] Legend not drawn: 'breaks' must be an array of finite numbers (e.g. [0, 10, 20]). Got:",
            breaks
        );
        return;
    }

    const keyScaleMarginBase = {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        ...(config.keyScaleMargin || {})
    };
    const mapWidth = window.d3.select('#graphic').node().getBoundingClientRect().width || 400;
    const width = mapWidth;
    const height = 39;

    const resolveBaseConfigByDataset = (key) => {
        const datasetCfg = (state && typeof state.datasetIndex === 'number' && Array.isArray(config.datasets))
            ? (config.datasets[state.datasetIndex] || config.datasets[0] || null)
            : null;
        if (datasetCfg && Object.prototype.hasOwnProperty.call(datasetCfg, key) && typeof datasetCfg[key] !== 'undefined') {
            return datasetCfg[key];
        }

        const val = config[key];
        if (!Array.isArray(val)) return val;
        if (!state) return val[0];

        const selectedIndex = (() => {
            if (typeof state.selectedValueColumn === 'number') return state.selectedValueColumn;
            if (Array.isArray(state.valueColumns) && state.selectedValueColumn) {
                const idx = state.valueColumns.indexOf(state.selectedValueColumn);
                return idx >= 0 ? idx : 0;
            }
            if (typeof state.datasetIndex === 'number') return state.datasetIndex;
            return 0;
        })();

        if (selectedIndex >= 0 && selectedIndex < val.length) return val[selectedIndex];
        return val[0];
    };

    const resolveConfigByDataset = (key) => {
        if (state && state.displayValueMode === 'change' && changeDisplayKeyMap[key]) {
            for (const changeKey of changeDisplayKeyMap[key]) {
                const changeValue = resolveBaseConfigByDataset(changeKey);
                if (changeValue !== null && typeof changeValue !== 'undefined') return changeValue;
            }
        }
        return resolveBaseConfigByDataset(key);
    };

    const legendFmt = window.d3.format(resolveConfigByDataset('legendFormat') || ',.2f');
    const legendPrefix = resolveConfigByDataset('legendPrefix') || '';
    const legendSuffix = resolveConfigByDataset('legendSuffix') || '';
    const tickData = breaks.map((d, i) => ({
        value: d,
        index: i,
        label: legendPrefix + legendFmt(d) + legendSuffix,
        x: null
    }));

    const getTickAnchor = (index) => {
        if (index === 0) return 'start';
        if (index === tickData.length - 1) return 'end';
        return 'middle';
    };

    const getTickBounds = (tick) => {
        const anchor = getTickAnchor(tick.index);
        if (anchor === 'start') {
            return { left: tick.labelX, right: tick.labelX + tick.width };
        }
        if (anchor === 'end') {
            return { left: tick.labelX - tick.width, right: tick.labelX };
        }
        return { left: tick.labelX - tick.width / 2, right: tick.labelX + tick.width / 2 };
    };

    const x = window.d3.scaleLinear()
        .domain([breaks[0], breaks[breaks.length - 1]])
        .range([0, width]);
    tickData.forEach(d => { d.x = d.labelX = x(d.value); });

    const scaleSvg = keyscale.append('svg')
        .attr('width', width)
        .attr('class', 'keyscale-svg');
    const tempTicks = scaleSvg
        .selectAll('text.keyscale-tick-temp')
        .data(tickData)
        .enter()
        .append('text')
        .attr('class', 'keyscale-tick keyscale-tick-temp')
        .attr('x', d => d.x)
        .attr('y', height + keyScaleMarginBase.top - 2)
        .attr('text-anchor', d => getTickAnchor(d.index))
        .attr('font-size', 13)
        .attr('fill', ONScolours.grey75)
        .style('opacity', 0)
        .text(d => d.label);
    const tickNodes = tempTicks.nodes();
    tickData.forEach((d, i) => {
        const bounds = tickNodes[i].getBBox();
        d.width = bounds.width;
        d.ascent = height + keyScaleMarginBase.top - 2 - bounds.y;
        d.descent = bounds.height - d.ascent;
        const { left, right } = getTickBounds(d);
        if (left < 0) d.labelX -= left;
        else if (right > width) d.labelX -= right - width;
    });
    tempTicks.remove();

    const minTickLabelGap = 6;
    const labelAscent = Math.max(...tickData.map(d => d.ascent));
    const labelDescent = Math.max(...tickData.map(d => d.descent));
    const rowHeight = labelAscent + labelDescent + 4;
    const rowRights = [];
    // Fill the nearest available row, alternating below and above the bar.
    tickData.forEach((d) => {
        const { left, right } = getTickBounds(d);
        let row = rowRights.findIndex(lastRight => left >= lastRight + minTickLabelGap);
        if (row === -1) row = rowRights.length;
        rowRights[row] = right;
        d.row = Math.floor(row / 2);
        d.above = row % 2 === 1;
        d.stagger = row > 0 || d.labelX !== d.x;
    });

    const aboveRows = Math.floor(rowRights.length / 2);
    const belowRows = Math.ceil(rowRights.length / 2);
    const aboveLabelGap = 20; // Leave room for the map-value indicators.
    const keyScaleMargin = {
        ...keyScaleMarginBase,
        top: keyScaleMarginBase.top + (aboveRows ? aboveLabelGap + labelAscent + (aboveRows - 1) * rowHeight : 0),
        bottom: keyScaleMarginBase.bottom + Math.max(0, belowRows - 1) * rowHeight + Math.max(0, labelDescent - 2)
    };
    tickData.forEach(d => {
        d.y = d.above
            ? keyScaleMargin.top - aboveLabelGap - d.row * rowHeight
            : keyScaleMargin.top + height - 2 + d.row * rowHeight;
    });
    scaleSvg.attr('height', height + keyScaleMargin.top + keyScaleMargin.bottom);

    // Draw colored rectangles for each break interval
    const breakRanges = breaks.slice(0, -1).map((d, i) => ({
        min: d,
        max: breaks[i + 1],
        index: i,
        isLast: i === breaks.length - 2
    }));

    scaleSvg.selectAll('rect.keyscale-rect')
        .data(breakRanges)
        .enter()
        .append('rect')
        .attr('x', d => x(d.min))
        .attr('y', keyScaleMargin.top)
        .attr('width', d => x(d.max) - x(d.min))
        .attr('height', height - 16)
        .attr('fill', d => colour((d.min + d.max) / 2))
        .attr('class', 'keyscale-rect')
        .on('mouseenter', (event, d) => {
            scaleSvg.selectAll('rect.keyscale-rect')
                .classed('is-dimmed', true)
                .classed('is-hovered', false);
            window.d3.select(event.currentTarget)
                .classed('is-dimmed', false)
                .classed('is-hovered', true);
            if (state && typeof state.onLegendRangeHover === 'function') {
                state.onLegendRangeHover(d);
            }
        })
        .on('mouseleave', () => {
            scaleSvg.selectAll('rect.keyscale-rect')
                .classed('is-dimmed', false)
                .classed('is-hovered', false);
            if (state && typeof state.onLegendRangeLeave === 'function') {
                state.onLegendRangeLeave();
            }
        });

    if (tickData.some(d => d.stagger)) {
        scaleSvg.selectAll('line.keyscale-tick-leader')
            .data(tickData.filter(d => d.stagger))
            .enter()
            .append('line')
            .attr('class', 'keyscale-tick-leader')
            .attr('x1', d => d.x)
            .attr('x2', d => d.labelX)
            .attr('y1', d => keyScaleMargin.top + (d.above ? 0 : height - 16))
            .attr('y2', d => d.above ? d.y + labelDescent : d.y - labelAscent)
            .attr('stroke', ONScolours.grey75)
            .attr('stroke-width', 1.1)
            .attr('stroke-dasharray', '2,2');
    }

    // Draw the ticks with staggered positions
    scaleSvg.selectAll('text.keyscale-tick')
        .data(tickData)
        .enter()
        .append('text')
        .attr('class', d => 'keyscale-tick' + (d.stagger ? ' keyscale-tick-stagger' : ''))
        .attr('x', d => d.labelX)
        .attr('y', d => d.y)
        .attr('text-anchor', d => getTickAnchor(d.index))
        .attr('font-size', 13)
        .attr('fill', ONScolours.grey75)
        .text(d => d.label);

    // Add indicator(s): main (hover), and faded (selected)
    const triangleWidth = 18;
    const triangleHeight = 14;
    // Main indicator (for hover)
    scaleSvg.append('polygon')
        .attr('id', 'key-indicator')
        .attr('points', `0,0 ${triangleWidth},0 ${triangleWidth / 2},${triangleHeight}`)
        .attr('fill', ONScolours.white)
        .attr('stroke', ONScolours.black)
        .attr('stroke-width', 2.4)
        .attr('stroke-linejoin', 'round')
        .attr('transform', `translate(${x(breaks[0]) - triangleWidth / 2},${keyScaleMargin.top + (height / 2) - triangleHeight - 10})`)
        .style('display', 'none');
    // Faded indicator (for selected area)
    scaleSvg.append('polygon')
        .attr('id', 'key-indicator-selected')
        .attr('points', `0,0 ${triangleWidth},0 ${triangleWidth / 2},${triangleHeight}`)
        .attr('fill', ONScolours.white)
        .attr('stroke', ONScolours.black)
        .attr('stroke-width', 2.4)
        .attr('stroke-linejoin', 'round')
        .attr('opacity', 0.5)
        .attr('transform', `translate(${x(breaks[0]) - triangleWidth / 2},${keyScaleMargin.top + (height / 2) - triangleHeight - 10})`)
        .style('display', 'none');

    // Expose functions to move indicators
    window.moveKeyIndicator = function (val) {
        if (val === undefined || val === null || isNaN(val)) {
            scaleSvg.select('#key-indicator').style('display', 'none');
        } else {
            scaleSvg.select('#key-indicator')
                .attr('transform', `translate(${x(val) - triangleWidth / 2},${keyScaleMargin.top + (height / 2) - triangleHeight - 10})`)
                .raise()
                .style('display', null);
        }
    };
    window.moveKeyIndicatorSelected = function (val) {
        if (val === undefined || val === null || isNaN(val)) {
            scaleSvg.select('#key-indicator-selected').style('display', 'none');
        } else {
            scaleSvg.select('#key-indicator-selected')
                .attr('transform', `translate(${x(val) - triangleWidth / 2},${keyScaleMargin.top + (height / 2) - triangleHeight - 10})`)
                .raise()
                .style('display', null);
        }
    };
}
