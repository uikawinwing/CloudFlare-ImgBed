import { applySiteBranding, getSiteConfig } from './site-config.js';

getSiteConfig().then(config => applySiteBranding(document, config));
