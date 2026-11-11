// Layout oracle only: this does not format CSS or replace the real Monaco E2E.
const rejected = () => ({ wrapper: false, width: false, paddingLeft: false, quoted: false, distinct: false });
const escape = value => value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');

export function inspectStyleDeclarationLines(text, expected) {
    if (typeof text !== 'string' || !expected ||
        !['width', 'paddingLeft', 'quoted'].every(key =>
            typeof expected[key] === 'string' && expected[key].length > 0 && !/[\r\n]/.test(expected[key]))) {
        return rejected();
    }
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    const indexes = (property, value) => {
        const pattern = new RegExp('^\\s*' + escape(property) + '\\s*:\\s*' + escape(value) + '\\s*;\\s*$');
        return lines.flatMap((line, index) => pattern.test(line) ? [index] : []);
    };
    const width = indexes('width', expected.width);
    const padding = indexes('padding-left', expected.paddingLeft);
    const quoted = indexes('--readability-label', expected.quoted);
    return {
        wrapper: lines.length === 5 && /^\s*element\.style\s*\{\s*$/.test(lines[0]) && /^\s*}\s*$/.test(lines[4]),
        width: width.length === 1,
        paddingLeft: padding.length === 1,
        quoted: quoted.length === 1,
        distinct: new Set([...width, ...padding, ...quoted]).size === 3
    };
}
