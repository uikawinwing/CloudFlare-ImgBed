import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { getIpVersion, isUnsafeIpAddress } from '../../functions/utils/ssrf.js';

function unsafeDestination(message) {
    const error = new Error(message);
    error.code = 'ERR_UNSAFE_DESTINATION';
    return error;
}

export async function resolvePublicAddresses(hostname, resolver = dnsLookup) {
    const normalizedHostname = hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;
    const literalVersion = getIpVersion(normalizedHostname);
    const records = literalVersion
        ? [{ address: normalizedHostname, family: literalVersion }]
        : await resolver(normalizedHostname, { all: true, verbatim: true });

    if (!Array.isArray(records) || records.length === 0) {
        throw unsafeDestination('Destination hostname did not resolve to an address');
    }

    for (const record of records) {
        if (!getIpVersion(record.address) || isUnsafeIpAddress(record.address)) {
            throw unsafeDestination('Destination hostname resolves to an internal address');
        }
    }

    return records;
}

export function createPinnedLookup(selected) {
    return function pinnedLookup(_hostname, options, callback) {
        if (options?.all) {
            callback(null, [selected]);
            return;
        }
        callback(null, selected.address, selected.family);
    };
}

export async function nodeSafeOutboundFetch(url) {
    const records = await resolvePublicAddresses(url.hostname);
    const selected = records[0];
    const requestImpl = url.protocol === 'https:' ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
        const outgoing = requestImpl(url, {
            method: 'GET',
            headers: { 'Accept-Encoding': 'identity' },
            agent: false,
            lookup: createPinnedLookup(selected),
        }, incoming => {
            const headers = new Headers();
            for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
                headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
            }

            const status = incoming.statusCode || 502;
            const bodyless = status === 204 || status === 205 || status === 304;
            if (bodyless) incoming.resume();

            resolve(new Response(bodyless ? null : Readable.toWeb(incoming), {
                status,
                statusText: incoming.statusMessage,
                headers,
            }));
        });

        outgoing.once('error', reject);
        outgoing.end();
    });
}
