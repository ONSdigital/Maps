import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { calculateBreaks, getBreaks } from './map-helpers.js';

globalThis.d3 = {
    ascending: (a, b) => a - b,
    min: values => Math.min(...values),
    max: values => Math.max(...values)
};
const statistics = {};
runInNewContext(readFileSync(new URL('../lib/simple-statistics.min.js', import.meta.url), 'utf8'), statistics);
globalThis.ss = statistics.ss;

const values = [1.23, 1.44, 3.56, 3.88, 6.56, 6.98, 9.12, 9.67];

test('omitting rounding or using null preserves calculated breaks', () => {
    assert.deepEqual(calculateBreaks([1, 11], 'equal', 4), [1, 3.5, 6, 8.5, 11]);
    assert.deepEqual(calculateBreaks(values, 'jenks', 4, null), [1.23, 3.56, 6.56, 9.12, 9.67]);
});

test('rounds equal and Jenks breaks at decimal through million intervals', () => {
    const cases = [
        { interval: 1e-7, equal: [1e-7, 3e-7, 5e-7, 8e-7, 1e-6], jenks: [1e-7, 4e-7, 7e-7, 9e-7, 1e-6] },
        { interval: 0.01, equal: [0.01, 0.03, 0.05, 0.08, 0.1], jenks: [0.01, 0.04, 0.07, 0.09, 0.1] },
        { interval: 0.1, equal: [0.1, 0.3, 0.5, 0.8, 1], jenks: [0.1, 0.4, 0.7, 0.9, 1] },
        { interval: 1, equal: [1, 3, 5, 8, 10], jenks: [1, 4, 7, 9, 10] },
        { interval: 10, equal: [10, 30, 50, 80, 100], jenks: [10, 40, 70, 90, 100] },
        { interval: 100, equal: [100, 300, 500, 800, 1000], jenks: [100, 400, 700, 900, 1000] },
        { interval: 1000, equal: [1000, 3000, 5000, 8000, 10000], jenks: [1000, 4000, 7000, 9000, 10000] },
        { interval: 10000, equal: [10000, 30000, 50000, 80000, 100000], jenks: [10000, 40000, 70000, 90000, 100000] },
        { interval: 1000000, equal: [1000000, 3000000, 5000000, 8000000, 10000000], jenks: [1000000, 4000000, 7000000, 9000000, 10000000] }
    ];
    for (const { interval, equal, jenks } of cases) {
        const scaled = values.map(value => value * interval);
        assert.deepEqual(calculateBreaks(scaled, 'equal', 4, interval), equal, `equal, interval ${interval}`);
        assert.deepEqual(calculateBreaks(scaled, 'jenks', 4, interval), jenks, `jenks, interval ${interval}`);
    }
});

test('handles decimal boundaries, negative values and non-power-of-ten intervals', () => {
    assert.deepEqual(calculateBreaks([0.29, 0.31], 'equal', 2, 0.01), [0.29, 0.3, 0.31]);
    assert.deepEqual(calculateBreaks([0.15, 0.75], 'equal', 3, 0.1), [0.1, 0.4, 0.6, 0.8]);
    assert.deepEqual(calculateBreaks([-0.75, -0.15], 'equal', 3, 0.1), [-0.8, -0.5, -0.3, -0.1]);
    assert.deepEqual(calculateBreaks([-0.39, 0.41], 'equal', 4, 0.1), [-0.4, -0.2, 0, 0.2, 0.5]);
    assert.deepEqual(calculateBreaks([1.1, 13.2], 'equal', 3, 2.5), [0, 5, 10, 15]);
    assert.deepEqual(calculateBreaks([0.11, 0.94], 'equal', 3, 0.05), [0.1, 0.4, 0.65, 0.95]);
});

test('rejects invalid rounding intervals and collapsed breaks explicitly', () => {
    for (const interval of [0, -1, '10', NaN, Infinity, -Infinity, true]) {
        assert.throws(() => calculateBreaks(values, 'equal', 4, interval), /config\.breaksRoundTo.*positive finite number/);
    }
    for (const method of ['equal', 'jenks']) {
        assert.throws(
            () => calculateBreaks(values, method, 4, 10),
            /config\.breaksRoundTo.*strictly increasing.*smaller interval/
        );
    }
});

test('resolves shared and per-dataset intervals without overriding null entries', () => {
    const data = values.map(value => ({ first: value, second: value * 10, third: value, fourth: value * 10 }));
    const palette = ['#111', '#333', '#555', '#777'];
    const state = { valueColumns: ['first', 'second', 'third', 'fourth'], selectedValueColumn: 'first' };
    const config = { breaks: 'equal', breaksRoundTo: [1, 10, null] };

    assert.deepEqual(getBreaks(config, data, palette, state), [1, 3, 5, 8, 10]);
    state.selectedValueColumn = 'second';
    assert.deepEqual(getBreaks(config, data, palette, state), [10, 30, 50, 80, 100]);
    state.selectedValueColumn = 'third';
    assert.deepEqual(getBreaks(config, data, palette, state), calculateBreaks(values, 'equal', 4));
    state.selectedValueColumn = 'fourth';
    assert.deepEqual(getBreaks(config, data, palette, state), [12, 33, 55, 76, 97]);

    config.breaks = ['equal', 'jenks'];
    state.selectedValueColumn = 'second';
    assert.deepEqual(getBreaks(config, data, palette, state), [10, 40, 70, 90, 100]);
    config.breaksRoundTo = 1;
    state.selectedValueColumn = 'first';
    assert.deepEqual(getBreaks(config, data, palette, state), [1, 3, 5, 8, 10]);
});

test('leaves shared and per-dataset custom breaks unchanged', () => {
    const custom = [0.12, 1.24, 2.38, 2.43];
    const config = { breaks: custom, breaksRoundTo: 1000 };
    const state = { selectedValueColumn: 'value', valueColumns: ['value'] };
    const data = values.map(value => ({ value }));
    const palette = ['#111', '#333', '#555'];
    assert.equal(getBreaks(config, data, palette, state), custom);
    config.breaks = [custom];
    assert.equal(getBreaks(config, data, palette, state), custom);
});
