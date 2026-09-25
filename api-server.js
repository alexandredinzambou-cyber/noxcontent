require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { searchFS, scrapeFilmPage, scrapeSeriesPage, scrapeCatalog, findBestMatch, scrapeMetadata, scrapeTmdbId } = require('./lib/scraper');
const { resolve } = require('./lib/resolvers');
const { resolveBaseUrl, getBaseUrl, HEADERS } = require('./lib/utils');
const cache = require('./lib/cache');

const app = express();
const PORT = process.env.PORT || 7001;
const path = require('path');
const fetch = require('node-fetch');
const TMDB_API_KEY = process.env.TMDB_API_KEY;

app.use(cors());
app.use(express.json());
// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// ── Helper: Format streams to include direct video URLs ──────────────────────
const LANG_FLAGS = { VF: 'VF 🇫🇷', VOSTFR: 'VOSTFR 🇬🇧+🇫🇷', VFQ: 'VFQ 🇨🇦', VFF: 'VFF 🇫🇷', VO: 'VO 🇬🇧' };

async function formatStreams(rawStreams, pageUrl, season, episode) {
    let fsTitle = '';
    try {
        const meta = await scrapeMetadata(pageUrl);
        if (meta && meta.name) fsTitle = meta.name;
    } catch {}
    if (!fsTitle) fsTitle = titleFromPageUrl(pageUrl);
    const descParts = [];
    if (fsTitle) descParts.push(fsTitle);
    if (season != null && episode != null) descParts.push(`Saison ${season} - Épisode ${episode}`);
    const description = descParts.join('\n');
    
    const results = await Promise.allSettled(
        rawStreams.map(async (s) => {
            const resolved = await resolve(s.url, s.player);
            const langLabel = LANG_FLAGS[s.lang] || s.lang;
            const name = s.playerName;
            const streamDesc = [...descParts, langLabel].join('\n');

            if (resolved) {
                const isHls = resolved.url.includes('.m3u8');
                return {
                    name,
                    description: streamDesc,
                    player: s.player,
                    playerName: s.playerName,
                    lang: s.lang,
                    url: resolved.url,
                    headers: resolved.headers || {},
                    isHls,
                    type: isHls ? 'hls' : 'mp4'
                };
            }
            console.log(`[API] ${s.player} ${s.lang} skipped (resolve failed): ${s.url}`);
            return null;
        })
    );

    return results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
}

function titleFromPageUrl(pageUrl) {
    if (!pageUrl) return '';
    const match = pageUrl.match(/\/(\d+)-(.*?)\.html/);
    if (!match) return '';
    return match[2].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Helper: Get title from TMDB ID ─────────────────────────────────────────────
async function getTitleFromTmdb(tmdbType, tmdbId) {
    if (!TMDB_API_KEY) return null;
    try {
        const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=fr-FR`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.title || data.name || null;
    } catch {
        return null;
    }
}

// ── Helper: Find FS page by title (search + best match) ────────────────────────
async function findFsPageByTitle(title, type) {
    await resolveBaseUrl();
    const results = await searchFS(title);
    if (!results.length) return null;
    
    const typeFiltered = results.filter(r => r.type === type);
    const candidates = typeFiltered.length > 0 ? typeFiltered : results;
    
    const { normalizeForSearch, cleanTitle } = require('./lib/utils');
    const normalizedTitle = normalizeForSearch(title);
    
    let bestMatch = candidates[0];
    let bestScore = 0;
    
    for (const candidate of candidates) {
        const candidateNorm = normalizeForSearch(cleanTitle(candidate.title));
        let score = 0;
        
        if (candidateNorm === normalizedTitle) {
            score = 100;
        } else if (candidateNorm.includes(normalizedTitle) || normalizedTitle.includes(candidateNorm)) {
            score = 80;
        } else {
            const words1 = normalizedTitle.split(/\s+/);
            const words2 = candidateNorm.split(/\s+/);
            const common = words1.filter(w => words2.includes(w)).length;
            score = (common / Math.max(words1.length, words2.length)) * 60;
        }
        
        if (score > bestScore) {
            bestScore = score;
            bestMatch = candidate;
        }
    }
    
    return bestMatch ? bestMatch.url : null;
}
// ── API Routes ────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', baseUrl: getBaseUrl() });
});

// Initialize - resolve base URL
app.post('/init', async (req, res) => {
    try {
        await resolveBaseUrl();
        res.json({ success: true, baseUrl: getBaseUrl() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Search movies/series
app.get('/search', async (req, res) => {
    try {
        const { q, type } = req.query;
        if (!q) return res.status(400).json({ error: 'Query parameter "q" is required' });
        
        await resolveBaseUrl();
        const results = await searchFS(q);
        
        let filtered = results;
        if (type) {
            filtered = results.filter(r => r.type === type);
        }
        
        res.json({ query: q, type: type || 'all', count: filtered.length, results: filtered });
    } catch (err) {
        console.error('[API] Search error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Get catalog (films, series, boxoffice, communaute)
app.get('/catalog', async (req, res) => {
    try {
        const { type = 'movie', id = 'films', skip = 0 } = req.query;
        await resolveBaseUrl();
        const results = await scrapeCatalog(type, id, parseInt(skip));
        res.json({ type, id, skip: parseInt(skip), count: results.length, results });
    } catch (err) {
        console.error('[API] Catalog error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Get movie streams
app.get('/movie/:id/streams', async (req, res) => {
    try {
        const { id } = req.params;
        const { pageUrl: customPageUrl } = req.query;
        await resolveBaseUrl();
        
        // Use custom pageUrl if provided, otherwise try to construct from ID
        const pageUrl = customPageUrl || `${getBaseUrl()}/films/${id}.html`;
        const rawStreams = await scrapeFilmPage(pageUrl);
        const streams = await formatStreams(rawStreams, pageUrl, null, null);
        
        const meta = await scrapeMetadata(pageUrl);
        
        res.json({ 
            id, 
            pageUrl, 
            meta,
            count: streams.length, 
            streams 
        });
    } catch (err) {
        console.error('[API] Movie streams error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Get series streams (season/episode)
app.get('/series/:id/streams', async (req, res) => {
    try {
        const { id } = req.params;
        const { season, episode, pageUrl: customPageUrl } = req.query;
        
        if (!season || !episode) {
            return res.status(400).json({ error: 'season and episode query parameters are required' });
        }
        
        await resolveBaseUrl();
        
        // Use custom pageUrl if provided, otherwise try to construct from ID
        const pageUrl = customPageUrl || `${getBaseUrl()}/series/${id}.html`;
        const rawStreams = await scrapeSeriesPage(pageUrl, parseInt(season), parseInt(episode));
        const streams = await formatStreams(rawStreams, pageUrl, parseInt(season), parseInt(episode));
        
        const meta = await scrapeMetadata(pageUrl);
        
        res.json({ 
            id, 
            season: parseInt(season), 
            episode: parseInt(episode),
            pageUrl, 
            meta,
            count: streams.length, 
            streams 
        });
    } catch (err) {
        console.error('[API] Series streams error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Get streams by TMDB ID
app.get('/tmdb/:type/:tmdbId/streams', async (req, res) => {
    try {
        const { type, tmdbId } = req.params;
        const { season, episode, title: providedTitle } = req.query;
        
        if (!['movie', 'tv'].includes(type)) {
            return res.status(400).json({ error: 'type must be "movie" or "tv"' });
        }
        
        const tmdbType = type === 'movie' ? 'movie' : 'tv';
        
        // Get title: from TMDB API if key available, otherwise from query param
        let title = providedTitle || await getTitleFromTmdb(tmdbType, tmdbId);
        if (!title) {
            return res.status(400).json({ 
                error: 'Could not determine title. Provide "title" query parameter or set TMDB_API_KEY env var.' 
            });
        }
        
        // Find FrenchStream page
        const fsType = type === 'movie' ? 'movie' : 'series';
        const pageUrl = await findFsPageByTitle(title, fsType);
        if (!pageUrl) {
            return res.status(404).json({ error: 'No matching content found on FrenchStream' });
        }
        
        await resolveBaseUrl();
        
        if (type === 'movie') {
            const rawStreams = await scrapeFilmPage(pageUrl);
            const streams = await formatStreams(rawStreams, pageUrl, null, null);
            const meta = await scrapeMetadata(pageUrl);
            
            res.json({ 
                tmdbId, 
                type,
                title,
                pageUrl, 
                meta,
                count: streams.length, 
                streams 
            });
        } else {
            if (!season || !episode) {
                return res.status(400).json({ error: 'season and episode query parameters are required for TV series' });
            }
            
            const rawStreams = await scrapeSeriesPage(pageUrl, parseInt(season), parseInt(episode));
            const streams = await formatStreams(rawStreams, pageUrl, parseInt(season), parseInt(episode));
            const meta = await scrapeMetadata(pageUrl);
            
            res.json({ 
                tmdbId, 
                type,
                title,
                season: parseInt(season), 
                episode: parseInt(episode),
                pageUrl, 
                meta,
                count: streams.length, 
                streams 
            });
        }
    } catch (err) {
        console.error('[API] TMDB streams error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Get metadata for a page
app.get('/meta', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ error: 'url parameter is required' });
        
        await resolveBaseUrl();
        const meta = await scrapeMetadata(url);
        
        if (!meta) return res.status(404).json({ error: 'Metadata not found' });
        
        res.json({ url, meta });
    } catch (err) {
        console.error('[API] Meta error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Resolve a direct embed URL
app.post('/resolve', async (req, res) => {
    try {
        const { url, player } = req.body;
        if (!url || !player) {
            return res.status(400).json({ error: 'url and player are required in body' });
        }
        
        await resolveBaseUrl();
        const result = await resolve(url, player);
        
        if (!result) {
            return res.status(404).json({ error: 'Could not resolve stream' });
        }
        
        res.json({ url, player, resolved: result });
    } catch (err) {
        console.error('[API] Resolve error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Get all available players
app.get('/players', (req, res) => {
    res.json({
        players: [
            { key: 'premium', name: 'FSvid / Premium' },
            { key: 'vidzy', name: 'Vidzy' },
            { key: 'uqload', name: 'Uqload' },
            { key: 'voe', name: 'Voe' },
            { key: 'dood', name: 'Dood' },
            { key: 'filmoon', name: 'Filmoon' }
        ],
        languages: ['VF', 'VOSTFR', 'VFQ', 'VFF', 'VO']
    });
});

// Clear cache
app.post('/cache/clear', (req, res) => {
    cache.clear();
    res.json({ success: true, message: 'Cache cleared' });
});

// Cache stats
app.get('/cache/stats', (req, res) => {
    res.json(cache.stats());
});

// Start server — bind TOUJOURS immédiatement (Railway coupe un conteneur qui
// ne répond pas au healthcheck). La résolution du domaine FS (landing →
// passerelle → miroir, potentiellement lente ou bloquée depuis un datacenter)
// tourne en arrière-plan ; le fallback fsXX.lol reste utilisé en attendant.
const fsResolveChain = resolveBaseUrl().catch(err => {
    console.error('[FS] Resolution failed at startup (fallback kept):', err.message);
});

app.listen(PORT, () => {
    console.log(`FrenchStream API running at http://localhost:${PORT}`);
    console.log(`TMDB API Key: ${TMDB_API_KEY ? 'configured' : 'NOT SET (title param required)'}`);
    console.log('');
    console.log('Available endpoints:');
    console.log('  GET  /health                 - Health check');
    console.log('  POST /init                   - Initialize (resolve base URL)');
    console.log('  GET  /search?q=<query>&type=<movie|series>  - Search');
    console.log('  GET  /catalog?type=movie&id=films&skip=0    - Catalog');
    console.log('  GET  /movie/:id/streams      - Movie streams');
    console.log('  GET  /series/:id/streams?season=1&episode=1 - Series streams');
    console.log('  GET  /tmdb/:type/:tmdbId/streams?season=1&episode=1&title=... - Streams by TMDB ID');
    console.log('  GET  /meta?url=<pageUrl>     - Metadata');
    console.log('  POST /resolve                - Resolve embed URL (body: {url, player})');
    console.log('  GET  /players                - List available players');
    console.log('  POST /cache/clear            - Clear cache');
    console.log('  GET  /cache/stats            - Cache statistics');
});

// Log la résolution FS dès qu'elle aboutit (sans bloquer l'écoute).
fsResolveChain.then(() => {
    console.log(`[FS] Base URL after startup: ${getBaseUrl()}`);
});
