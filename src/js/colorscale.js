import { scaleLinear } from "d3";

// NPS-themed color scale
// Not visited: tan (matches NPS signage background)
// Visited: forest green (matches NPS nature theme)
const lowerRange = "#d2b48c";
const upperRange = "#2d5a27";

const color = scaleLinear().domain([0, 1]).range([lowerRange, upperRange]);

export default color;
