function parseIPv4(address) {
    const match = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!match) return null;

    const octets = match.slice(1).map(value => Number.parseInt(value, 10));
    return octets.every(value => value >= 0 && value <= 255) ? octets : null;
}

function parseIPv6(address) {
    let value = address.toLowerCase();
    if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);

    const zoneIndex = value.indexOf('%');
    if (zoneIndex !== -1) value = value.slice(0, zoneIndex);

    if (value.includes('.')) {
        const lastColon = value.lastIndexOf(':');
        if (lastColon === -1) return null;
        const ipv4 = parseIPv4(value.slice(lastColon + 1));
        if (!ipv4) return null;
        value = `${value.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
    }

    const halves = value.split('::');
    if (halves.length > 2) return null;

    const parseWords = part => part
        ? part.split(':').map(word => /^[0-9a-f]{1,4}$/.test(word) ? Number.parseInt(word, 16) : NaN)
        : [];
    const left = parseWords(halves[0]);
    const right = parseWords(halves[1] || '');
    if ([...left, ...right].some(Number.isNaN)) return null;

    if (halves.length === 1) return left.length === 8 ? left : null;
    if (left.length + right.length >= 8) return null;

    return [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
}

export function getIpVersion(address) {
    const value = String(address || '');
    if (parseIPv4(value)) return 4;
    if (parseIPv6(value)) return 6;
    return 0;
}

export function isUnsafeIpAddress(address) {
    const value = String(address || '');
    const ipv4 = parseIPv4(value);
    if (ipv4) {
        const [a, b] = ipv4;
        return a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 0 || b === 168)) ||
            (a === 198 && (b === 18 || b === 19)) ||
            a >= 224;
    }

    const ipv6 = parseIPv6(value);
    if (!ipv6) return false;

    const allZero = ipv6.every(word => word === 0);
    const loopback = ipv6.slice(0, 7).every(word => word === 0) && ipv6[7] === 1;
    const uniqueLocal = (ipv6[0] & 0xfe00) === 0xfc00;
    const linkLocal = (ipv6[0] & 0xffc0) === 0xfe80;
    const siteLocal = (ipv6[0] & 0xffc0) === 0xfec0;
    const multicast = (ipv6[0] & 0xff00) === 0xff00;
    if (allZero || loopback || uniqueLocal || linkLocal || siteLocal || multicast) return true;

    const embeddedIPv4 = ipv6.slice(0, 5).every(word => word === 0) &&
        (ipv6[5] === 0 || ipv6[5] === 0xffff);
    const wellKnownNat64 = ipv6[0] === 0x64 && ipv6[1] === 0xff9b &&
        ipv6.slice(2, 6).every(word => word === 0);
    if (embeddedIPv4 || wellKnownNat64) {
        const mapped = `${ipv6[6] >> 8}.${ipv6[6] & 0xff}.${ipv6[7] >> 8}.${ipv6[7] & 0xff}`;
        return isUnsafeIpAddress(mapped);
    }

    return false;
}
