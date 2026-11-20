const NAMES = new Set(`
aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod
darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon
darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray
dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green
greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon
lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon
lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy
oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip
peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal
thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor none
`.trim().split(/\s+/));

const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i;
const number = (value: string) => NUMBER.test(value);
const percentage = (value: string) => value.endsWith('%') && number(value.slice(0, -1));
const channel = (value: string) => number(value) || percentage(value);
const hue = (value: string) => number(value.replace(/(?:deg|grad|rad|turn)$/i, ''));

function channels(values: string[], hsl: boolean, legacy: boolean): boolean {
  if (values.length !== 3) return false;
  if (hsl) return hue(values[0]!) && percentage(values[1]!) && percentage(values[2]!);
  if (legacy) return values.every(number) || values.every(percentage);
  return values.every(channel);
}

function functionalColor(body: string, hsl: boolean): boolean {
  if (body.includes(',')) {
    const values = body.split(',').map((v) => v.trim());
    if (values.length === 4 && !channel(values.pop()!)) return false;
    return channels(values, hsl, true);
  }
  const [values, alpha, ...extra] = body.split('/');
  if (extra.length || (alpha !== undefined && !channel(alpha.trim()))) return false;
  return channels(values!.trim().split(/\s+/), hsl, false);
}

/** Supported CSS colors and SVG paint keywords, without DOM or theme dependencies. */
export function isColor(value: string): boolean {
  if (NAMES.has(value.toLowerCase())) return true;
  if (value.startsWith('#')) return [4, 5, 7, 9].includes(value.length) && /^#[\da-f]+$/i.test(value);
  const match = /^(rgba?|hsla?)\(([^()]*)\)$/i.exec(value);
  return !!match && functionalColor(match[2]!, match[1]!.toLowerCase().startsWith('hsl'));
}
