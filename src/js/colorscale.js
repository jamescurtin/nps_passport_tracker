import { scaleLinear } from "d3";

const lowerRange = "rgb(210,180,140)";
const upperRange = "rgb(0,128,0)";

const color = scaleLinear().domain([0, 1]).range([lowerRange, upperRange]);

export default color;
