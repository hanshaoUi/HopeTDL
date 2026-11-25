export function specKey(value) {
  return JSON.stringify(normalize(value))
}
function normalize(value) {
  if(Array.isArray(value))return value.map(normalize)
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalize(value[k])]))
  return value
}
export function invalidNumbers(value) {
  if(typeof value==='number')return !Number.isSafeInteger(value)||value<0
  if(Array.isArray(value))return value.some(invalidNumbers)
  return value && typeof value==='object' ? Object.values(value).some(invalidNumbers) : false
}
