function toFloat32(value) {
  return Math.fround(Number(value));
}

function outputWearFromRelativeFloat32(relativeWear, minfloat, maxfloat) {
  const outMin = toFloat32(minfloat);
  const outMax = toFloat32(maxfloat);
  const range = toFloat32(outMax - outMin);
  const scaled = toFloat32(toFloat32(relativeWear) * range);
  return toFloat32(outMin + scaled);
}

module.exports = {
  outputWearFromRelativeFloat32
};
