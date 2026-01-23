// legend.js
// Handles drawing the key scale and indicators for the map legend

export function drawKeyScale({ keyscale, breaks, colour, config, window, state }) {
    keyscale.selectAll('*').remove();
    const mapWidth = window.d3.select('#graphic').node().getBoundingClientRect().width || 400;
    const width = mapWidth - config.keyScaleMargin.left - config.keyScaleMargin.right;
    let height = 39;

    const resolveConfigByDataset = (key) => {
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

    const legendFmt = window.d3.format(resolveConfigByDataset('legendFormat') || ',.2f');
    const legendPrefix = resolveConfigByDataset('legendPrefix') || '';
    const legendSuffix = resolveConfigByDataset('legendSuffix') || '';
    const tickData = breaks.map((d, i) => ({
        value: d,
        index: i,
        label: legendPrefix + legendFmt(d) + legendSuffix,
        x: null
    }));

    const x = window.d3.scaleLinear()
        .domain([breaks[0], breaks[breaks.length - 1]])
        .range([config.keyScaleMargin.left, width + config.keyScaleMargin.left]);
    tickData.forEach(d => { d.x = x(d.value); });

    // This is all to do with working out if dropticks are needed (overlap)
    // First, create the ticks (invisible) to measure their widths
    const tempTicks = d3.select(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
        .selectAll('text.keyscale-tick-temp')
        .data(tickData)
        .enter()
        .append('text')
        .attr('class', 'keyscale-tick-temp')
        .attr('x', d => d.x)
        .attr('y', height + config.keyScaleMargin.top - 2)
        .attr('text-anchor', 'middle')
        .attr('font-size', 13)
        .attr('fill', ONScolours.grey75)
        .style('opacity', 0)
        .text(d => d.label);
    // Attach to DOM to measure
    document.body.appendChild(tempTicks.node().ownerSVGElement);
    tickData.forEach((d, i) => {
        const node = tempTicks.nodes()[i];
        d.width = node ? node.getBBox().width : 0;
    });
    // Remove temp SVG
    tempTicks.node().ownerSVGElement.remove();

    // Check for any overlaps
    let lastRight = -Infinity;
    let anyOverlap = false;
    tickData.forEach((d) => {
        const left = d.x - d.width / 2;
        if (left < lastRight) {
            anyOverlap = true;
        }
        lastRight = Math.max(lastRight, d.x + d.width / 2);
    });

    // Set y positions: alternate if any overlap, else all baseline
    const yBase = height + config.keyScaleMargin.top - 2;
    const yOffset = 13; // vertical offset for staggered ticks
    tickData.forEach((d, i) => {
        if (anyOverlap) {
            d.stagger = (i % 2 === 1);
            d.y = yBase + (d.stagger ? yOffset : 0);
        } else {
            d.stagger = false;
            d.y = yBase;
        }
    });

    // If dropticks, increase bottom margin to fit lower row
    let keyScaleMargin = { ...config.keyScaleMargin };
    if (anyOverlap) {
        keyScaleMargin = { ...keyScaleMargin, bottom: (config.keyScaleMargin.bottom || 0) + yOffset + 4 };
    }

    // Now create the SVG with possibly increased bottom margin
    const scaleSvg = keyscale.append('svg')
        .attr('width', width + keyScaleMargin.left + keyScaleMargin.right)
        .attr('height', height + keyScaleMargin.top + keyScaleMargin.bottom)
        .attr('class', 'keyscale-svg');



    // Draw colored rectangles for each break interval
    for (let i = 0; i < breaks.length - 1; i++) {
        scaleSvg.append('rect')
            .attr('x', x(breaks[i]))
            .attr('y', keyScaleMargin.top)
            .attr('width', x(breaks[i + 1]) - x(breaks[i]))
            .attr('height', height - 16)
            .attr('fill', colour((breaks[i] + breaks[i + 1]) / 2))
            // .attr('stroke', '#fff')
            // .attr('stroke-width', 1)
            .attr('class', 'keyscale-rect');
    }

    // Draw leader lines for dropped ticks if anyOverlap
    if (anyOverlap) {
        const colorBarTop = keyScaleMargin.top + height - 16;
        scaleSvg.selectAll('line.keyscale-tick-leader')
            .data(tickData.filter(d => d.stagger))
            .enter()
            .append('line')
            .attr('class', 'keyscale-tick-leader')
            .attr('x1', d => d.x)
            .attr('x2', d => d.x)
            .attr('y1', colorBarTop)
            .attr('y2', d => d.y - 11)
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
        .attr('x', d => d.x)
        .attr('y', d => d.y)
        .attr('text-anchor', 'middle')
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
