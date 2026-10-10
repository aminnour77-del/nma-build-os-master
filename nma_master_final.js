'use strict';

const path = require('path');

module.exports = function installNmaMasterFinal({ app, mongoose, requireAuth, requireRole }) {
  if (!app || !mongoose || !requireAuth || !requireRole) {
    throw new Error('NMA Master Final: dipendenze mancanti');
  }

  const supervisorOnly = [requireAuth, requireRole('supervisore', 'admin')];

  const model = (name) => mongoose.models && mongoose.models[name] ? mongoose.models[name] : null;
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  const text = (value, fallback = '—') => {
    if (value === null || value === undefined || value === '') return fallback;
    return String(value);
  };
  const first = (obj, keys, fallback = undefined) => {
    for (const key of keys) {
      const parts = key.split('.');
      let cur = obj;
      let ok = true;
      for (const part of parts) {
        if (cur && Object.prototype.hasOwnProperty.call(cur, part)) cur = cur[part];
        else { ok = false; break; }
      }
      if (ok && cur !== undefined && cur !== null && cur !== '') return cur;
    }
    return fallback;
  };
  const asArray = (value) => Array.isArray(value) ? value : [];
  const safeLean = async (Model, limit = 200) => {
    if (!Model) return [];
    try {
      return await Model.find({}).sort({ _id: -1 }).limit(limit).lean();
    } catch (_) {
      return [];
    }
  };
  const safeCount = async (Model, query = {}) => {
    if (!Model) return 0;
    try { return await Model.countDocuments(query); }
    catch (_) { return 0; }
  };

  function normaliseCoordinates(doc) {
    const candidates = [
      first(doc, ['geometry.coordinates']),
      first(doc, ['geojson.coordinates']),
      first(doc, ['linea.coordinates']),
      first(doc, ['tracciato.coordinates']),
      first(doc, ['coordinates']),
      first(doc, ['coordinate'])
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      if (Array.isArray(candidate) && candidate.length && Array.isArray(candidate[0])) {
        const coords = candidate
          .map((p) => [Number(p[0]), Number(p[1])])
          .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (coords.length >= 2) return coords;
      }
    }

    const lat = Number(first(doc, ['lat', 'latitude', 'gps.lat', 'posizione.lat']));
    const lng = Number(first(doc, ['lng', 'lon', 'longitude', 'gps.lng', 'gps.lon', 'posizione.lng']));
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [[lng, lat]];
    return [];
  }

  function publicCollaudo(doc) {
    return {
      id: text(first(doc, ['id_collaudo', 'idCollaudo', 'codice', '_id'])),
      cantiere: text(first(doc, ['cantiere', 'cantiere_id', 'cantiereId'])),
      tratta: text(first(doc, ['tratta', 'tratto', 'tratto_id', 'asset_id'])),
      pressione: first(doc, ['pressione', 'pressione_bar', 'test.pressione'], null),
      operatore: text(first(doc, ['operatore', 'operator', 'utente'])),
      strumento: text(first(doc, ['strumento', 'device', 'strumento_id'])),
      timestamp: first(doc, ['timestamp', 'createdAt', 'data', 'date'], null),
      hash: text(first(doc, ['hash', 'sha256', 'integrity_hash']), ''),
      stato: text(first(doc, ['stato', 'status', 'esito']), 'registrato')
    };
  }

  function publicCantiere(doc) {
    return {
      id: text(first(doc, ['codice', 'id_cantiere', 'cantiere', '_id'])),
      indirizzo: text(first(doc, ['indirizzo', 'address', 'localita', 'luogo'])),
      descrizione: text(first(doc, ['descrizione', 'lavoro', 'tipo_lavoro', 'attivita'])),
      avanzamento: Math.max(0, Math.min(100, num(first(doc, ['avanzamento', 'progress', 'percentuale'], 0)))),
      squadre: Math.max(0, num(first(doc, ['squadre', 'squadre_attive', 'team_count'], 0))),
      stato: text(first(doc, ['stato', 'status']), 'attivo'),
      fine: first(doc, ['fine', 'data_fine', 'end_date'], null)
    };
  }

  function isAnomaly(doc) {
    const value = first(doc, ['anomalia', 'anomaly', 'has_anomaly', 'anomalie']);
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    if (typeof value === 'string') return !['', '0', 'false', 'no', 'nessuna', 'none'].includes(value.toLowerCase());
    return false;
  }

  app.get('/api/master/final/health', ...supervisorOnly, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const mongoState = mongoose.connection ? mongoose.connection.readyState : 0;
    res.json({
      ok: true,
      product: 'NMA BUILD OS MASTER',
      version: '1.0-final',
      mongodb: mongoState === 1 ? 'CONNECTED' : 'DISCONNECTED',
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/master/final/summary', ...supervisorOnly, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    const Cantiere = model('Cantiere');
    const Collaudo = model('Collaudo');
    const TrattoRete = model('TrattoRete');
    const InterventoCampo = model('InterventoCampo');
    const ManutenzioneRete = model('ManutenzioneRete');

    const [cantieri, collaudi, tratti, interventi, manutenzioni] = await Promise.all([
      safeLean(Cantiere, 500),
      safeLean(Collaudo, 1500),
      safeLean(TrattoRete, 3000),
      safeLean(InterventoCampo, 3000),
      safeLean(ManutenzioneRete, 1000)
    ]);

    let metri = 0;
    let valore = 0;
    const squadre = new Set();
    for (const d of tratti) {
      metri += num(first(d, ['metri', 'lunghezza', 'length', 'metriTubo'], 0));
    }
    for (const d of collaudi) {
      valore += num(first(d, ['valore_produzione_eur', 'valore_produzione', 'valore'], 0));
      const sq = first(d, ['squadra', 'team']);
      if (sq) squadre.add(String(sq));
    }
    for (const d of interventi) {
      metri += num(first(d, ['metri_reali', 'metri', 'lunghezza_reale', 'misura.metri'], 0));
      const sq = first(d, ['squadra', 'team', 'squadra_id']);
      if (sq) squadre.add(String(sq));
    }

    const anomalie = interventi.filter(isAnomaly).length + manutenzioni.filter(isAnomaly).length;
    const validated = interventi.filter((d) => {
      const s = String(first(d, ['stato', 'status', 'quality_status'], '')).toLowerCase();
      return ['validato', 'validated', 'chiuso', 'closed', 'completato', 'completed'].includes(s);
    }).length;

    res.json({
      ok: true,
      kpi: {
        collaudi: collaudi.length,
        cantieri: cantieri.length,
        interventi: interventi.length,
        validati: validated,
        metri: Math.round(metri * 100) / 100,
        squadre_attive: squadre.size,
        anomalie_aperte: anomalie,
        manutenzioni: manutenzioni.length,
        valore_produzione_eur: Math.round(valore * 100) / 100
      },
      source: 'database',
      generated_at: new Date().toISOString()
    });
  });

  app.get('/api/master/final/collaudi', ...supervisorOnly, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const docs = await safeLean(model('Collaudo'), 12);
    res.json({ ok: true, items: docs.map(publicCollaudo) });
  });

  app.get('/api/master/final/cantieri', ...supervisorOnly, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const docs = await safeLean(model('Cantiere'), 8);
    res.json({ ok: true, items: docs.map(publicCantiere) });
  });

  app.get('/api/master/final/map', ...supervisorOnly, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const docs = await safeLean(model('TrattoRete'), 1200);
    const features = [];

    for (const doc of docs) {
      const coordinates = normaliseCoordinates(doc);
      if (coordinates.length < 2) continue;
      features.push({
        type: 'Feature',
        properties: {
          id: text(first(doc, ['tratto_id', 'id_tratto', 'codice', '_id'])),
          cantiere: text(first(doc, ['cantiere', 'cantiere_id'])),
          materiale: text(first(doc, ['materiale', 'material'])),
          diametro: text(first(doc, ['diametro', 'diameter'])),
          stato: text(first(doc, ['stato', 'status']), 'registrato'),
          profondita: first(doc, ['profondita', 'depth'], null)
        },
        geometry: { type: 'LineString', coordinates }
      });
    }

    res.json({
      ok: true,
      type: 'FeatureCollection',
      features,
      real_records: features.length
    });
  });

  app.get('/api/master/final/asset', ...supervisorOnly, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const docs = await safeLean(model('TrattoRete'), 1);
    const d = docs[0] || null;
    if (!d) return res.json({ ok: true, asset: null });
    const coordinates = normaliseCoordinates(d);
    res.json({
      ok: true,
      asset: {
        id: text(first(d, ['tratto_id', 'id_tratto', 'codice', '_id'])),
        cantiere: text(first(d, ['cantiere', 'cantiere_id'])),
        materiale: text(first(d, ['materiale', 'material'])),
        diametro: text(first(d, ['diametro', 'diameter'])),
        profondita: first(d, ['profondita', 'depth'], null),
        stato: text(first(d, ['stato', 'status']), 'registrato'),
        lunghezza: first(d, ['metri', 'lunghezza', 'length', 'metriTubo'], null),
        coordinates_count: coordinates.length
      }
    });
  });

  app.get('/api/master/final/alerts', ...supervisorOnly, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const [interventi, manutenzioni] = await Promise.all([
      safeLean(model('InterventoCampo'), 300),
      safeLean(model('ManutenzioneRete'), 150)
    ]);

    const alerts = [];
    for (const d of interventi) {
      if (!isAnomaly(d)) continue;
      alerts.push({
        level: 'high',
        title: text(first(d, ['anomalia', 'anomaly']), 'Anomalia intervento'),
        location: text(first(d, ['cantiere', 'luogo', 'indirizzo'])),
        timestamp: first(d, ['updatedAt', 'timestamp', 'createdAt'], null)
      });
      if (alerts.length >= 6) break;
    }
    if (alerts.length < 6) {
      for (const d of manutenzioni) {
        alerts.push({
          level: 'warn',
          title: text(first(d, ['tipo', 'descrizione', 'title']), 'Manutenzione rete'),
          location: text(first(d, ['cantiere', 'asset', 'luogo'])),
          timestamp: first(d, ['updatedAt', 'timestamp', 'createdAt'], null)
        });
        if (alerts.length >= 6) break;
      }
    }

    res.json({ ok: true, items: alerts });
  });

  app.get('/api/master/final/logs', ...supervisorOnly, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const docs = await safeLean(model('AuditLog'), 15);
    const items = docs.map((d) => ({
      timestamp: first(d, ['timestamp', 'createdAt', 'data'], null),
      type: text(first(d, ['tipo', 'action', 'evento']), 'INFO'),
      message: text(first(d, ['descrizione', 'message', 'details', 'azione']), 'Evento audit'),
      actor: text(first(d, ['operatore', 'actor', 'user']), '')
    }));
    res.json({ ok: true, items });
  });

  const moduleFiles = {
    campo: 'campo_operatore_v1.html',
    supervisore: 'supervisore_v1.html',
    workflow: 'workflow_v1.html',
    quality: 'quality_v1.html',
    audit: 'audit_v1.html',
    passaporto: 'passaporto_v1.html',
    asset: 'asset_memory_v1.html',
    network: 'network_memory_v1.html',
    spatial: 'spatial_twin_v1.html',
    control: 'control_room_v2.html',
    command: 'command_center_v1.html',
    sal: 'sal_v2.html',
    asbuilt: 'confronto_asbuilt_v1.html',
    correzioni: 'correzioni_v1.html'
  };

  app.get('/master-final/module/:key', ...supervisorOnly, (req, res) => {
    const file = moduleFiles[String(req.params.key || '')];
    if (!file) return res.status(404).send('Modulo non disponibile');
    return res.sendFile(path.join(__dirname, file));
  });
};
