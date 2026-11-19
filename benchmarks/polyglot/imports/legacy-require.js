'use strict';

const { alpha, beta: renamed } = require('./named');
const whole = require('./whole');
// require('./commented-out')
const text = "require('./inside-a-string')";
const tpl = `require('./inside-a-template')`;
const resolved = require.resolve('./not-an-edge');
require(`./template-specifier`);

module.exports = { alpha, renamed, whole, text, tpl, resolved };
