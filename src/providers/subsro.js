const res = await http.get(`https://api.subs.ro/v1.0/search/imdbid/${imdbIdFull}?language=ro`, {
    headers: { 
      'X-Subs-Api-Key': apiKey,
      'User-Agent': 'SubtitleAggregator v1.0.0', 
      'Accept': 'application/json' 
    }
  });

  // 1. TEMPORARY LOGGING: This will print the API's exact response to your Vercel logs
  console.log(`SUBSRO RESPONSE for ${imdbIdFull}:`, JSON.stringify(res.data).substring(0, 300));

  // 2. UNWRAP THE JSON ENVELOPE
  let subsArray = [];
  if (Array.isArray(res.data)) {
    subsArray = res.data;
  } else if (res.data && Array.isArray(res.data.data)) {
    subsArray = res.data.data; // OpenSubtitles style
  } else if (res.data && Array.isArray(res.data.collection)) {
    subsArray = res.data.collection; // Standard REST style
  } else if (res.data && Array.isArray(res.data.subtitles)) {
    subsArray = res.data.subtitles; // SubDL style
  } else {
    // If it's none of the above, the API couldn't find the movie or returned an error
    return [];
  }

  const results = [];
  
  // 3. Loop over our unwrapped array
  for (const sub of subsArray) {
    if (type === 'series') {
      if (parseInt(sub.season) !== parseInt(season) || parseInt(sub.episode) !== parseInt(episode)) {
        continue;
      }
    }

    const isoLang = fromProviderCode(sub.language, 'subsro');
    if (!isoLang || !requestedSubsroLangs.includes(sub.language)) continue;

    const payload = Buffer.from(JSON.stringify({ id: sub.id })).toString('base64url');
    results.push({
      id: payload,
      lang: isoLang,
      provider: 'subsro',
      releaseName: sub.release
    });
  }
  return results;
};
