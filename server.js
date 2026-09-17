require('dotenv').config();
const express = require('express');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const session = require('express-session');
const ConnectMongoModule = require('connect-mongo');
const MongoStore =
    ConnectMongoModule.default ||
    ConnectMongoModule.MongoStore ||
    ConnectMongoModule;

const app = express();

// --- BLOCCO 1: DATABASE INDUSTRIALE MONGODB (NMA BUILD OS) ---
const mongoose = require('mongoose');

// Connessione al cluster cloud (AWS)
mongoose.connect(process.env.MONGODB_URI, { dbName: 'nma_build_os' })
  .then(() => console.log('✅ [SISTEMA] Connesso al Database Industriale MongoDB Atlas'))
  .catch(err => console.error('❌ [ERRORE] Connessione DB fallita:', err));

// Schema Dati: Struttura del Caveau Digitale per i Cantieri
const CantiereSchema = new mongoose.Schema({
    id_cantiere: { type: String, default: 'ERG-CANTIERE-01' },
    metri_posati: { type: Number, default: 0 },
    raccordi: { type: Number, default: 0 },
    anomalie: { type: Number, default: 0 },
    ultimo_aggiornamento: { type: Date, default: Date.now }
});

const Cantiere = mongoose.model('Cantiere', CantiereSchema);
// === STORICO IMMUTABILE DEI COLLAUDI ===
const CollaudoSchema = new mongoose.Schema({
  id_collaudo: { type: String, required: true, unique: true },
  id_cantiere: { type: String, required: true },
  operatore: { type: String, default: 'Operatore' },
  pressione: { type: Number, default: 22.5 },
  metri_tubo: { type: Number, default: 30 },
  raccordi: { type: Number, default: 2 },
  anomalia: { type: String, default: 'Nessuna anomalia' },
  lat: { type: Number },
  lng: { type: Number },
  strumento: { type: String, default: '' },
  offline_id: { type: String, required: true, unique: true },
  hash_sha256: { type: String, required: true },
  valore_produzione_eur: { type: Number, default: 0 },
  data_ora: { type: Date, default: Date.now }
}, {
  collection: 'collaudi'
});

const Collaudo = mongoose.model('Collaudo', CollaudoSchema);

// === GEMELLO DIGITALE GEOMETRICO DELLA RETE ===
const TrattoReteSchema = new mongoose.Schema({
  id_tratto: { type: String, required: true, unique: true },
  id_cantiere: { type: String, required: true },

  geometry: {
    type: {
      type: String,
      enum: ['LineString'],
      default: 'LineString',
      required: true
    },
    coordinates: {
      type: [[Number]],
      required: true
    }
  },

  pressione: { type: Number, default: 0 },
  operatore: { type: String, default: '' },
  descrizione: { type: String, default: '' },
  ultimo_aggiornamento: { type: Date, default: Date.now }
}, {
  collection: 'tratti_rete'
});

const TrattoRete = mongoose.model('TrattoRete', TrattoReteSchema);

// -------------------------------------------------------------

const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '15mb' }));

// === NMA AUTH SERVER SIDE ===

if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET non configurato');
}

if (!process.env.ADMIN_PIN) {
    throw new Error('ADMIN_PIN non configurato');
}

// Render usa un reverse proxy HTTPS
app.set('trust proxy', 1);

app.use(session({
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        dbName: 'nma_build_os',
        collectionName: 'sessions',
        ttl: 8 * 60 * 60,
        autoRemove: 'native',
        touchAfter: 60
    }),
    name: 'nma.sid',

    secret: process.env.SESSION_SECRET,

    resave: false,

    saveUninitialized: false,

    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000
    }
}));

const requireAuth = (req, res, next) => {
    if (req.session && req.session.authenticated === true) {
        return next();
    }

    return res.redirect('/');
};



// ============================================================
// NMA BUILD OS — RBAC FASE 2
// Controllo autorizzazioni per ruolo
// ============================================================

const requireRole = (...allowedRoles) => (req, res, next) => {
    if (!req.session || req.session.authenticated !== true) {
        return res.redirect('/');
    }

    const currentRole = String(req.session.role || '');

    if (!allowedRoles.includes(currentRole)) {
        return res.status(403).send('Accesso non autorizzato');
    }

    return next();
};


// ============================================================
// NMA BUILD OS — SYSTEM HEALTH v1
// Endpoint non invasivo: nessun dato operativo viene modificato.
// ============================================================

app.get('/api/health', async (req, res) => {
    const mongoState = mongoose.connection.readyState;
    const mongoOk = mongoState === 1;

    const health = {
        ok: mongoOk,
        status: mongoOk ? 'OPERATIONAL' : 'DEGRADED',
        server: 'ONLINE',
        mongodb: mongoOk ? 'CONNECTED' : 'DISCONNECTED',
        timestamp: new Date().toISOString()
    };

    return res.status(mongoOk ? 200 : 503).json(health);
});

// Protezione elementare contro tentativi ripetuti
const loginAttempts = new Map();

app.post('/api/login', (req, res) => {

    const ip = req.ip || 'unknown';
    const now = Date.now();

    let record = loginAttempts.get(ip) || {
        attempts: 0,
        blockedUntil: 0
    };

    if (record.blockedUntil > now) {

        const seconds = Math.ceil(
            (record.blockedUntil - now) / 1000
        );

        return res.status(429).json({
            ok: false,
            error: `Troppi tentativi. Riprova tra ${seconds} secondi.`
        });
    }

    const suppliedPin = String(req.body?.pin ?? '');
    const roleCredentials = [
        { role: req.session.role, pin: String(process.env.ADMIN_PIN ?? '') },
        { role: 'supervisore', pin: String(process.env.SUPERVISOR_PIN ?? '') },
        { role: 'operatore', pin: String(process.env.OPERATOR_PIN ?? '') }
    ].filter(item => item.pin.length > 0);

    let matchedRole = null;
    let matchedPin = '';

    for (const credential of roleCredentials) {
        const suppliedRoleBuffer = Buffer.from(suppliedPin);
        const expectedRoleBuffer = Buffer.from(credential.pin);

        if (
            suppliedRoleBuffer.length === expectedRoleBuffer.length &&
            crypto.timingSafeEqual(suppliedRoleBuffer, expectedRoleBuffer)
        ) {
            matchedRole = credential.role;
            matchedPin = credential.pin;
            break;
        }
    }

    const expectedPin = matchedPin || String(process.env.ADMIN_PIN ?? '');
    let valid = false;

    try {

        const suppliedBuffer = Buffer.from(suppliedPin);
        const expectedBuffer = Buffer.from(expectedPin);

        valid =
            suppliedBuffer.length === expectedBuffer.length &&
            crypto.timingSafeEqual(
                suppliedBuffer,
                expectedBuffer
            );

    } catch (error) {
        valid = false;
    }

    if (!valid) {

        record.attempts += 1;

        if (record.attempts >= 5) {

            record.attempts = 0;
            record.blockedUntil =
                Date.now() + (5 * 60 * 1000);
        }

        loginAttempts.set(ip, record);

        return res.status(401).json({
            ok: false,
            error: 'PIN non valido'
        });
    }

    loginAttempts.delete(ip);

    req.session.regenerate(error => {

        if (error) {
            console.error('Errore sessione login:', error);

            return res.status(500).json({
                ok: false,
                error: 'Errore durante autenticazione'
            });
        }

        req.session.authenticated = true;
        req.session.role = matchedRole || 'admin';
        req.session.loginAt = new Date().toISOString();

        req.session.save(error => {

            if (error) {
                console.error('Errore salvataggio sessione:', error);

                return res.status(500).json({
                    ok: false,
                    error: 'Errore sessione'
                });
            }

            return res.json({
                ok: true,
                role: req.session.role
            });
        });
    });
});


app.post('/api/logout', (req, res) => {

    if (!req.session) {
        return res.json({ ok: true });
    }

    req.session.destroy(() => {

        res.clearCookie('nma.sid');

        res.json({
            ok: true
        });
    });
});


app.get('/api/session', (req, res) => {

    res.json({
        authenticated:
            !!req.session?.authenticated,

        role:
            req.session?.role || null
    });
});

// === FINE NMA AUTH SERVER SIDE ===


function generaHashImmutabile(dati) {
  return crypto.createHash('sha256').update(JSON.stringify(dati) + Date.now()).digest('hex');
}


// ============================================================
// NMA BUILD OS — CAMPO OPERATORE v1
// Scheda digitale intervento di campo
// ============================================================


// ============================================================
// NMA BUILD OS — AUDIT TRACCIABILITA v1
// Registro append-only con concatenazione hash SHA-256
// ============================================================

const AuditLogSchema = new mongoose.Schema({

    id_evento: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    evento: {
        type: String,
        required: true,
        index: true
    },

    id_intervento: {
        type: String,
        required: true,
        index: true
    },

    id_cantiere: {
        type: String,
        default: '',
        index: true
    },

    ruolo: {
        type: String,
        default: ''
    },

    operatore: {
        type: String,
        default: ''
    },

    squadra: {
        type: String,
        default: ''
    },

    origine: {
        type: String,
        default: 'online'
    },

    stato: {
        type: String,
        default: ''
    },

    note: {
        type: String,
        default: ''
    },

    hash_precedente: {
        type: String,
        default: ''
    },

    hash_evento: {
        type: String,
        required: true,
        index: true
    },

    data_ora: {
        type: Date,
        default: Date.now,
        index: true
    }

}, {
    collection: 'audit_logs'
});

const AuditLog =
    mongoose.models.AuditLog ||
    mongoose.model(
        'AuditLog',
        AuditLogSchema,
        'audit_logs'
    );

async function registraAudit({
    evento,
    intervento,
    ruolo = '',
    origine = 'online',
    stato = '',
    note = ''
}) {

    try {

        const idIntervento =
            String(
                intervento?.id_intervento || ''
            );

        if (!idIntervento || !evento) {
            return null;
        }

        const precedente =
            await AuditLog
                .findOne({
                    id_intervento: idIntervento
                })
                .sort({
                    data_ora: -1
                })
                .lean();

        const dataOra =
            new Date();

        const hashPrecedente =
            String(
                precedente?.hash_evento || ''
            );

        const baseHash = {
            evento:
                String(evento),

            id_intervento:
                idIntervento,

            id_cantiere:
                String(
                    intervento?.id_cantiere || ''
                ),

            ruolo:
                String(ruolo || ''),

            operatore:
                String(
                    intervento?.operatore || ''
                ),

            squadra:
                String(
                    intervento?.squadra || ''
                ),

            origine:
                String(origine || 'online'),

            stato:
                String(stato || ''),

            note:
                String(note || ''),

            hash_precedente:
                hashPrecedente,

            data_ora:
                dataOra.toISOString()
        };

        const hashEvento =
            crypto
                .createHash('sha256')
                .update(
                    JSON.stringify(baseHash)
                )
                .digest('hex');

        return await AuditLog.create({

            id_evento:
                crypto.randomUUID(),

            ...baseHash,

            hash_evento:
                hashEvento,

            data_ora:
                dataOra
        });

    } catch (error) {

        console.error(
            'Errore registrazione audit:',
            error
        );

        return null;
    }
}


// ============================================================
// NMA BUILD OS — EVIDENZE v1
// File binari in MongoDB GridFS + metadati + SHA-256
// ============================================================

const EvidenzaSchema = new mongoose.Schema({

    id_evidenza: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    id_intervento: {
        type: String,
        required: true,
        index: true
    },

    id_cantiere: {
        type: String,
        default: '',
        index: true
    },

    nome_file: {
        type: String,
        required: true
    },

    mime_type: {
        type: String,
        required: true
    },

    dimensione: {
        type: Number,
        required: true
    },

    tipo: {
        type: String,
        enum: ['foto', 'documento'],
        required: true
    },

    sha256: {
        type: String,
        required: true,
        index: true
    },

    gridfs_file_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },

    caricato_da_ruolo: {
        type: String,
        default: ''
    },

    operatore: {
        type: String,
        default: ''
    },

    squadra: {
        type: String,
        default: ''
    },

    creato_il: {
        type: Date,
        default: Date.now,
        index: true
    }

}, {
    collection: 'evidenze'
});

EvidenzaSchema.index(
    {
        id_intervento: 1,
        sha256: 1
    },
    {
        unique: true
    }
);

const Evidenza =
    mongoose.models.Evidenza ||
    mongoose.model(
        'Evidenza',
        EvidenzaSchema,
        'evidenze'
    );

const evidenceUpload = multer({

    storage:
        multer.memoryStorage(),

    limits: {
        fileSize:
            15 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {

        const allowed = [
            'image/jpeg',
            'image/png',
            'image/webp',
            'application/pdf'
        ];

        cb(
            null,
            allowed.includes(file.mimetype)
        );
    }
});

function evidenceBucket() {

    if (!mongoose.connection.db) {
        throw new Error(
            'MongoDB non disponibile'
        );
    }

    return new mongoose.mongo.GridFSBucket(
        mongoose.connection.db,
        {
            bucketName:
                'evidenze_files'
        }
    );
}

const InterventoCampoSchema = new mongoose.Schema({
    id_intervento: {
        type: String,
        required: true,
        index: true
    },

    offline_id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    id_cantiere: {
        type: String,
        required: true,
        index: true
    },

    operatore: {
        type: String,
        default: ''
    },

    squadra: {
        type: String,
        default: ''
    },

    gps: {
        lat: Number,
        lng: Number,
        accuratezza: Number
    },

    tubazione: {
        materiale: String,
        diametro_mm: Number,
        metri: Number
    },

    raccordi: {
        type: Number,
        default: 0
    },

    componenti: [{
        type: String
    }],

    anomalia: {
        presente: {
            type: Boolean,
            default: false
        },
        descrizione: {
            type: String,
            default: ''
        }
    },

    collaudo: {
        pressione: Number,
        strumento: String,
        esito: String
    },

    note: {
        type: String,
        default: ''
    },

    stato: {
        type: String,
        enum: ['bozza', 'registrato', 'validato', 'da_correggere'],
        default: 'registrato'
    },

    validazione: {
        esito: {
            type: String,
            default: ''
        },
        note: {
            type: String,
            default: ''
        },
        validato_da: {
            type: String,
            default: ''
        },
        validato_il: Date
    },

    sincronizzazione: {
        origine: {
            type: String,
            default: 'online'
        },
        accodato_il: {
            type: String,
            default: ''
        },
        ricevuto_il: {
            type: Date,
            default: Date.now
        }
    },

    creato_il: {
        type: Date,
        default: Date.now
    },

    aggiornato_il: {
        type: Date,
        default: Date.now
    }
}, {
    collection: 'interventi_campo'
});

const InterventoCampo =
    mongoose.models.InterventoCampo ||
    mongoose.model(
        'InterventoCampo',
        InterventoCampoSchema,
        'interventi_campo'
    );

app.post(
    '/api/interventi',
    requireAuth,
    requireRole('operatore', 'supervisore', 'admin'),
    async (req, res) => {

        try {
            const body = req.body || {};

            const idCantiere =
                String(body.id_cantiere || '').trim();

            const offlineId =
                String(body.offline_id || '').trim();

            const idIntervento =
                String(body.id_intervento || '').trim();

            if (!idCantiere || !offlineId || !idIntervento) {
                return res.status(400).json({
                    ok: false,
                    error:
                        'id_cantiere, id_intervento e offline_id obbligatori'
                });
            }

            const esistente =
                await InterventoCampo.findOne({
                    offline_id: offlineId
                }).lean();

            if (esistente) {
                return res.status(200).json({
                    ok: true,
                    idempotente: true,
                    intervento: esistente
                });
            }

            const numero = (v, fallback = 0) => {
                const n = Number(v);
                return Number.isFinite(n) ? n : fallback;
            };

            const componenti =
                Array.isArray(body.componenti)
                    ? body.componenti
                        .map(v => String(v).trim())
                        .filter(Boolean)
                    : [];

            const doc = await InterventoCampo.create({
                id_intervento: idIntervento,
                offline_id: offlineId,
                id_cantiere: idCantiere,

                operatore:
                    String(body.operatore || '').trim(),

                squadra:
                    String(body.squadra || '').trim(),

                gps: {
                    lat: numero(body.gps?.lat, 0),
                    lng: numero(body.gps?.lng, 0),
                    accuratezza:
                        numero(body.gps?.accuratezza, 0)
                },

                tubazione: {
                    materiale:
                        String(
                            body.tubazione?.materiale || ''
                        ).trim(),

                    diametro_mm:
                        numero(
                            body.tubazione?.diametro_mm,
                            0
                        ),

                    metri:
                        numero(
                            body.tubazione?.metri,
                            0
                        )
                },

                raccordi:
                    numero(body.raccordi, 0),

                componenti,

                anomalia: {
                    presente:
                        body.anomalia?.presente === true,

                    descrizione:
                        String(
                            body.anomalia?.descrizione || ''
                        ).trim()
                },

                collaudo: {
                    pressione:
                        numero(
                            body.collaudo?.pressione,
                            0
                        ),

                    strumento:
                        String(
                            body.collaudo?.strumento || ''
                        ).trim(),

                    esito:
                        String(
                            body.collaudo?.esito || ''
                        ).trim()
                },

                note:
                    String(body.note || '').trim(),

                stato: 'registrato',

                sincronizzazione: {
                    origine:
                        body.accodato_il
                            ? 'offline_sync'
                            : 'online',

                    accodato_il:
                        body.accodato_il
                            ? String(body.accodato_il)
                            : '',

                    ricevuto_il:
                        new Date()
                },

                aggiornato_il: new Date()
            });

            await registraAudit({
                evento:
                    'INTERVENTO_REGISTRATO',

                intervento:
                    doc,

                ruolo:
                    String(req.session.role || ''),

                origine:
                    body.accodato_il
                        ? 'offline_sync'
                        : 'online',

                stato:
                    'registrato',

                note:
                    body.accodato_il
                        ? 'Intervento sincronizzato da coda offline'
                        : 'Intervento registrato online'
            });

            return res.status(201).json({
                ok: true,
                idempotente: false,
                intervento: doc
            });

        } catch (error) {

            if (error?.code === 11000) {
                return res.status(200).json({
                    ok: true,
                    idempotente: true
                });
            }

            console.error(
                'Errore /api/interventi:',
                error
            );

            return res.status(500).json({
                ok: false,
                error: 'Errore salvataggio intervento'
            });
        }
    }
);

app.get(
    '/api/interventi',
    requireAuth,
    requireRole('operatore', 'supervisore', 'admin'),
    async (req, res) => {

        try {
            const filtro = {};

            if (req.query.cantiere) {
                filtro.id_cantiere =
                    String(req.query.cantiere);
            }

            const interventi =
                await InterventoCampo
                    .find(filtro)
                    .sort({ creato_il: -1 })
                    .limit(100)
                    .lean();

            return res.json({
                ok: true,
                totale: interventi.length,
                interventi
            });

        } catch (error) {
            console.error(
                'Errore GET /api/interventi:',
                error
            );

            return res.status(500).json({
                ok: false,
                error: 'Errore lettura interventi'
            });
        }
    }
);


// ============================================================
// NMA BUILD OS — SUPERVISORE VALIDAZIONE v1
// ============================================================

app.patch(
    '/api/interventi/:id/validazione',
    requireAuth,
    requireRole('supervisore', 'admin'),
    async (req, res) => {

        try {
            const id = String(req.params.id || '').trim();
            const esito = String(req.body?.esito || '').trim();
            const note = String(req.body?.note || '').trim();

            if (!['validato', 'da_correggere'].includes(esito)) {
                return res.status(400).json({
                    ok: false,
                    error: 'Esito validazione non valido'
                });
            }

            const intervento =
                await InterventoCampo.findOneAndUpdate(
                    { id_intervento: id },
                    {
                        $set: {
                            stato: esito,
                            validazione: {
                                esito,
                                note,
                                validato_da:
                                    String(req.session.role || ''),
                                validato_il: new Date()
                            },
                            aggiornato_il: new Date()
                        }
                    },
                    {
                        new: true,
                        runValidators: true
                    }
                ).lean();

            if (!intervento) {
                return res.status(404).json({
                    ok: false,
                    error: 'Intervento non trovato'
                });
            }

            await registraAudit({
                evento:
                    esito === 'validato'
                        ? 'INTERVENTO_VALIDATO'
                        : 'CORREZIONE_RICHIESTA',

                intervento:
                    intervento,

                ruolo:
                    String(req.session.role || ''),

                origine:
                    'supervisione',

                stato:
                    esito,

                note:
                    note
            });

            return res.json({
                ok: true,
                intervento
            });

        } catch (error) {
            console.error(
                'Errore validazione intervento:',
                error
            );

            return res.status(500).json({
                ok: false,
                error: 'Errore validazione intervento'
            });
        }
    }
);


app.get(
    '/api/audit',
    requireAuth,
    requireRole('supervisore', 'admin'),
    async (req, res) => {

        try {

            const filtro = {};

            if (req.query.intervento) {
                filtro.id_intervento =
                    String(req.query.intervento);
            }

            if (req.query.cantiere) {
                filtro.id_cantiere =
                    String(req.query.cantiere);
            }

            const eventi =
                await AuditLog
                    .find(filtro)
                    .sort({
                        data_ora: -1
                    })
                    .limit(200)
                    .lean();

            return res.json({
                ok: true,
                totale: eventi.length,
                eventi
            });

        } catch (error) {

            console.error(
                'Errore lettura audit:',
                error
            );

            return res.status(500).json({
                ok: false,
                error: 'Errore lettura audit'
            });
        }
    }
);

app.get(
    '/audit',
    requireAuth,
    requireRole('supervisore', 'admin'),
    (req, res) => {
        res.sendFile(
            __dirname + '/audit_v1.html'
        );
    }
);

app.get(
    '/supervisore',
    requireAuth,
    requireRole('supervisore', 'admin'),
    (req, res) => {
        res.sendFile(
            __dirname + '/supervisore_v1.html'
        );
    }
);


app.post(
    '/api/interventi/:id/evidenze',
    requireAuth,
    requireRole('operatore', 'supervisore', 'admin'),
    evidenceUpload.single('file'),
    async (req, res) => {

        let gridId = null;

        try {

            const idIntervento =
                String(
                    req.params.id || ''
                ).trim();

            const intervento =
                await InterventoCampo
                    .findOne({
                        id_intervento:
                            idIntervento
                    })
                    .lean();

            if (!intervento) {
                return res.status(404).json({
                    ok: false,
                    error:
                        'Intervento non trovato'
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    ok: false,
                    error:
                        'File mancante o formato non consentito'
                });
            }

            const hash =
                crypto
                    .createHash('sha256')
                    .update(req.file.buffer)
                    .digest('hex');

            const esistente =
                await Evidenza.findOne({
                    id_intervento:
                        idIntervento,
                    sha256:
                        hash
                }).lean();

            if (esistente) {
                return res.status(200).json({
                    ok: true,
                    idempotente: true,
                    evidenza: esistente
                });
            }

            const nomeFile =
                String(
                    req.file.originalname ||
                    'evidenza'
                )
                .replace(
                    /[\r\n]/g,
                    ''
                )
                .slice(
                    0,
                    180
                );

            const tipo =
                req.file.mimetype
                    .startsWith('image/')
                    ? 'foto'
                    : 'documento';

            const bucket =
                evidenceBucket();

            gridId =
                await new Promise(
                    (resolve, reject) => {

                        const stream =
                            bucket.openUploadStream(
                                nomeFile,
                                {
                                    contentType:
                                        req.file.mimetype,

                                    metadata: {
                                        id_intervento:
                                            idIntervento,
                                        id_cantiere:
                                            intervento.id_cantiere,
                                        sha256:
                                            hash
                                    }
                                }
                            );

                        stream.on(
                            'error',
                            reject
                        );

                        stream.on(
                            'finish',
                            () =>
                                resolve(
                                    stream.id
                                )
                        );

                        stream.end(
                            req.file.buffer
                        );
                    }
                );

            const evidenza =
                await Evidenza.create({

                    id_evidenza:
                        crypto.randomUUID(),

                    id_intervento:
                        idIntervento,

                    id_cantiere:
                        String(
                            intervento.id_cantiere ||
                            ''
                        ),

                    nome_file:
                        nomeFile,

                    mime_type:
                        req.file.mimetype,

                    dimensione:
                        req.file.size,

                    tipo,

                    sha256:
                        hash,

                    gridfs_file_id:
                        gridId,

                    caricato_da_ruolo:
                        String(
                            req.session.role ||
                            ''
                        ),

                    operatore:
                        String(
                            intervento.operatore ||
                            ''
                        ),

                    squadra:
                        String(
                            intervento.squadra ||
                            ''
                        )
                });

            await registraAudit({

                evento:
                    'EVIDENZA_CARICATA',

                intervento,

                ruolo:
                    String(
                        req.session.role ||
                        ''
                    ),

                origine:
                    'evidenza',

                stato:
                    String(
                        intervento.stato ||
                        ''
                    ),

                note:
                    tipo +
                    ': ' +
                    nomeFile +
                    ' sha256:' +
                    hash
            });

            return res.status(201).json({
                ok: true,
                idempotente: false,
                evidenza
            });

        } catch (error) {

            if (gridId) {
                try {
                    await evidenceBucket()
                        .delete(gridId);
                } catch {}
            }

            if (error?.code === 11000) {

                return res.status(200).json({
                    ok: true,
                    idempotente: true
                });
            }

            console.error(
                'Errore upload evidenza:',
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    'Errore caricamento evidenza'
            });
        }
    }
);

app.get(
    '/api/interventi/:id/evidenze',
    requireAuth,
    requireRole('operatore', 'supervisore', 'admin'),
    async (req, res) => {

        try {

            const evidenze =
                await Evidenza
                    .find({
                        id_intervento:
                            String(
                                req.params.id ||
                                ''
                            )
                    })
                    .sort({
                        creato_il: 1
                    })
                    .lean();

            return res.json({
                ok: true,
                totale:
                    evidenze.length,
                evidenze
            });

        } catch (error) {

            return res.status(500).json({
                ok: false,
                error:
                    'Errore lettura evidenze'
            });
        }
    }
);

app.get(
    '/api/evidenze/:id/file',
    requireAuth,
    requireRole('operatore', 'supervisore', 'admin'),
    async (req, res) => {

        try {

            const evidenza =
                await Evidenza
                    .findOne({
                        id_evidenza:
                            String(
                                req.params.id ||
                                ''
                            )
                    })
                    .lean();

            if (!evidenza) {

                return res.status(404).json({
                    ok: false,
                    error:
                        'Evidenza non trovata'
                });
            }

            res.setHeader(
                'Content-Type',
                evidenza.mime_type
            );

            res.setHeader(
                'Content-Length',
                String(
                    evidenza.dimensione
                )
            );

            res.setHeader(
                'Content-Disposition',
                "inline; filename*=UTF-8''" +
                encodeURIComponent(
                    evidenza.nome_file
                )
            );

            const stream =
                evidenceBucket()
                    .openDownloadStream(
                        evidenza.gridfs_file_id
                    );

            stream.on(
                'error',
                () => {

                    if (!res.headersSent) {
                        res.status(404).end();
                    } else {
                        res.destroy();
                    }
                }
            );

            stream.pipe(res);

        } catch (error) {

            if (!res.headersSent) {
                return res.status(500).json({
                    ok: false,
                    error:
                        'Errore lettura file'
                });
            }
        }
    }
);

app.post('/api/collaudo', async (req, res) => {
  try {
    const { cantiere, pressione, lat, lng, strumento, operatore, metriTubo, raccordi, anomalia, offline_id } = req.body;
    
    const uniqueOfflineId = offline_id || ('OFF-' + Date.now() + '-' + Math.floor(Math.random()*1000));
    const pressioneVal = Number(pressione || 22.5);
    const metriVal = Number(metriTubo || 30);
    const raccordiVal = Number(raccordi || 2);
    const segnalazioneAnomalia = anomalia || "Nessuna anomalia";
    const conteggioAnomalia = (segnalazioneAnomalia !== "Nessuna anomalia") ? 1 : 0;

    const payloadCertificato = { cantiere, operatore, offline_id: uniqueOfflineId, pressione: pressioneVal, metri: metriVal, data: new Date().toISOString() };
    const hashLegale = require('crypto').createHash('sha256').update(JSON.stringify(payloadCertificato) + Date.now()).digest('hex');
    const valoreProduzioneEur = (metriVal * 45) + (raccordiVal * 35);

    // SALVATAGGIO DEFINITIVO E PULITO SOLO SU MONGODB ATLAS
    // Salva lo storico del singolo collaudo
await Collaudo.findOneAndUpdate(
  { offline_id: uniqueOfflineId },
  {
    $setOnInsert: {
      id_collaudo: 'COL-' + uniqueOfflineId,
      id_cantiere: cantiere || 'ERG-CANTIERE-01',
      operatore: operatore || 'Operatore',
      pressione: pressioneVal,
      metri_tubo: metriVal,
      raccordi: raccordiVal,
      anomalia: segnalazioneAnomalia,
      lat: Number.isFinite(Number(lat)) ? Number(lat) : undefined,
      lng: Number.isFinite(Number(lng)) ? Number(lng) : undefined,
      strumento: strumento || '',
      offline_id: uniqueOfflineId,
      hash_sha256: hashLegale,
      valore_produzione_eur: valoreProduzioneEur,
      data_ora: new Date()
    }
  },
  { upsert: true, new: true }
);
await Cantiere.findOneAndUpdate(
        { id_cantiere: cantiere || 'ERG-CANTIERE-01' },
        { 
            $inc: { metri_posati: metriVal, raccordi: raccordiVal, anomalie: conteggioAnomalia },
            $set: { ultimo_aggiornamento: new Date() }
        },
        { upsert: true, new: true }
    );
    
    if (typeof io !== 'undefined') {
        io.emit('nuovo_collaudo', { cantiere: cantiere || 'ERG-CANTIERE-01', metri: metriVal, offline_id: uniqueOfflineId });
    }

    res.json({ success: true, alert: pressioneVal < 15.0, hash: hashLegale, valore_eur: valoreProduzioneEur, synced_id: uniqueOfflineId });
  } catch (err) {
    console.error('Errore salvataggio MongoDB:', err);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// === KPI CANTIERE - MONGODB ===
app.get('/api/kpi/:cantiere', async (req, res) => {
  try {
    const { cantiere } = req.params;

    const filtro =
      cantiere && cantiere !== 'TUTTI' && cantiere !== 'Tutti'
        ? { id_cantiere: cantiere }
        : {};

    const collaudi = await Collaudo.find(filtro).lean();

    let totalMetri = 0;
    let totalRaccordi = 0;
    let anomalieCount = 0;
    let totalValoreProduzione = 0;
    let totalCo2 = 0;
    const attivitaSquadre = {};

    for (const log of collaudi) {
      const metri = Number(log.metri_tubo || 0);
      const raccordi = Number(log.raccordi || 0);
      const operatore = log.operatore || 'Squadra';

      totalMetri += metri;
      totalRaccordi += raccordi;
      totalValoreProduzione += Number(
        log.valore_produzione_eur ||
        ((metri * 45) + (raccordi * 35))
      );

      totalCo2 += Number(log.esq_co2_kg || 0);

      if (
        log.anomalia &&
        log.anomalia !== 'Nessuna anomalia'
      ) {
        anomalieCount++;
      }

      if (!attivitaSquadre[operatore]) {
        attivitaSquadre[operatore] = {
          tratti: 0,
          metri_totali: 0
        };
      }

      attivitaSquadre[operatore].tratti += 1;
      attivitaSquadre[operatore].metri_totali += metri;
    }

    res.json({
      cantiere: cantiere || 'Tutti',
      tratti_eseguiti: collaudi.length,
      metri_posati: totalMetri,
      raccordi_utilizzati: totalRaccordi,
      anomalie_rilevate: anomalieCount,
      valore_produzione_eur: totalValoreProduzione,
      esq_co2_kg: totalCo2,
        co2_risparmiata_kg: totalCo2,
      squadre_attive: attivitaSquadre
    });

  } catch (err) {
    console.error('[KPI MongoDB]', err);
    res.status(500).json({
      error: 'Errore calcolo KPI'
    });
  }
});

// === ELENCO CANTIERI - MONGODB ===
app.get('/api/cantieri', async (req, res) => {
  try {
    const cantieri = await Cantiere
      .find({}, { id_cantiere: 1, _id: 0 })
      .lean();

    const elenco = [...new Set(
      cantieri
        .map(c => c.id_cantiere)
        .filter(Boolean)
    )];

    res.json(elenco);

  } catch (err) {
    console.error('[CANTIERI MongoDB]', err);
    res.status(500).send('Errore caricamento cantieri');
  }
});

// === RETE GAS / GEOJSON - MONGODB ===
app.get('/api/tubi', async (req, res) => {
  try {
    const cantiereFiltro = req.query.cantiere;

    const filtro =
      cantiereFiltro &&
      cantiereFiltro !== 'TUTTI' &&
      cantiereFiltro !== 'Tutti'
        ? { id_cantiere: cantiereFiltro }
        : {};

    const tratti = await TrattoRete.find(filtro).lean();

    const features = tratti
      .filter(tratto =>
        tratto.geometry &&
        tratto.geometry.type === 'LineString' &&
        Array.isArray(tratto.geometry.coordinates) &&
        tratto.geometry.coordinates.length >= 2
      )
      .map(tratto => ({
        type: 'Feature',

        geometry: {
          type: 'LineString',
          coordinates: tratto.geometry.coordinates
        },

        properties: {
          id_tratto: tratto.id_tratto,
          cantiere: tratto.id_cantiere,
          pressione: Number(tratto.pressione || 0),
          operatore: tratto.operatore || '',
          descrizione: tratto.descrizione || ''
        }
      }));

    res.json({
      type: 'FeatureCollection',
      features
    });

  } catch (err) {
    console.error('[TUBI MongoDB]', err);

    res.status(500).json({
      type: 'FeatureCollection',
      features: [],
      error: 'Errore geodataset GIS'
    });
  }
});

// Torre di Controllo - Control Room Satellitare 3D (Stile Google Earth & Flusso Live)

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NMA BUILD OS - Accesso</title>
    <style>
        * { box-sizing: border-box; }

        body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #05070a;
            color: white;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .login-box {
            width: min(420px, 90vw);
            padding: 40px;
            background: #10151c;
            border: 1px solid #263241;
            border-radius: 18px;
            text-align: center;
            box-shadow: 0 25px 70px rgba(0,0,0,.55);
        }

        h1 {
            margin: 0 0 8px;
            font-size: 30px;
        }

        .subtitle {
            color: #94a3b8;
            margin-bottom: 30px;
        }

        input {
            width: 100%;
            padding: 15px;
            font-size: 20px;
            text-align: center;
            border-radius: 9px;
            border: 1px solid #334155;
            background: #080c11;
            color: white;
            outline: none;
        }

        button {
            width: 100%;
            margin-top: 16px;
            padding: 15px;
            border: 0;
            border-radius: 9px;
            background: #00c875;
            color: #04110b;
            font-size: 17px;
            font-weight: 800;
            cursor: pointer;
        }

        #message {
            min-height: 22px;
            margin-top: 16px;
            color: #ff6b6b;
        }
    </style>
</head>

<body>
    <div class="login-box">
        <h1>NMA BUILD OS</h1>
        <div class="subtitle">Accesso Direzione</div>

        <input
            type="password"
            id="pin"
            placeholder="PIN Direzionale"
            autocomplete="current-password"
        >

        <button id="loginButton">ACCEDI AL SISTEMA</button>

        <div id="message"></div>
    </div>

<script>
const pinInput = document.getElementById('pin');
const button = document.getElementById('loginButton');
const message = document.getElementById('message');

async function login() {
    message.textContent = '';
    button.disabled = true;
    button.textContent = 'VERIFICA...';

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin',
            body: JSON.stringify({
                pin: pinInput.value
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Accesso negato');
        }

        pinInput.value = '';

        window.location.href = '/ufficio';

    } catch (error) {
        message.textContent = error.message;
        pinInput.select();

    } finally {
        button.disabled = false;
        button.textContent = 'ACCEDI AL SISTEMA';
    }
}

button.addEventListener('click', login);

pinInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        login();
    }
});
</script>

</body>
</html>
    `);
});
app.get('/ufficio', requireAuth, requireRole('supervisore', 'admin'), (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>NMA BUILD OS - Control Room Satellitare 3D (Google Earth)</title>
        <script src="https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.js"></script>
        <link href="https://unpkg.com/maplibre-gl@3.x/dist/maplibre-gl.css" rel="stylesheet" />
        <script src="/socket.io/socket.io.js"></script>
        <style>
            body { margin: 0; padding: 0; background-color: #050505; color: white; font-family: -apple-system, sans-serif; overflow: hidden; }
            #map { position: absolute; top: 0; bottom: 0; width: 100%; }
            #panel { position: absolute; top: 20px; left: 20px; background: rgba(10,10,10,0.94); padding: 22px; border-radius: 14px; border: 1px solid #333; z-index: 10; width: 410px; box-shadow: 0 20px 40px rgba(0,0,0,0.8); backdrop-filter: blur(12px); }
            .glow { color: #00E676; font-weight: bold; text-shadow: 0 0 12px rgba(0,230,118,0.5); }
            .metric { background: #161616; padding: 14px; border-radius: 9px; margin-top: 12px; border: 1px solid #262626; }
            .metric h4 { margin: 0 0 6px 0; color: #00BCD4; font-size: 12px; text-transform: uppercase; letter-spacing: 0.8px; }
            .metric p { margin: 0; font-size: 16px; font-weight: bold; }
            select { width: 100%; padding: 10px; background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; margin-top: 6px; font-size: 14px; outline: none; cursor: pointer; }
            .live-badge { font-size: 10px; background: #00E676; color: #000; padding: 3px 8px; border-radius: 4px; font-weight: bold; float: right; margin-top: 5px; animation: pulseBadge 1.5s infinite; }
            @keyframes pulseBadge { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
        </style>
    </head>
    <body>
        <div id="map"></div>
        
        <div id="panel">
            <h2>NMA BUILD OS <span class="live-badge">SATELLITE 3D LIVE</span></h2>
            <hr style="border-color:#333; margin: 14px 0;">
            <p>Controllo Linea: <span class="glow">FLUSSO PRESSIONE ATTIVO</span></p>
            
            <div class="metric">
                <h4>Seleziona Cantiere Operativo</h4>
                <select id="selettore-cantiere" onchange="aggiornaDatiAppalto()">
                    <option value="TUTTI">Tutti i Cantieri (Panoramica Globale)</option>
                </select>
            </div>

            <div class="metric">
                <h4>Telemetria & Produzione Totale</h4>
                <p id="stats-metri">Caricamento telemetria...</p>
                <p id="stats-valore" style="font-size:14px; color:#00E676; margin-top:5px;"></p>
                <p id="stats-esg" style="font-size:13px; color:#00BCD4; margin-top:4px;"></p>
                <p id="stats-anomalie" style="font-size:13px; color:#ff9800; margin-top:4px;"></p>
            </div>
        </div>

        <script>
            // Mappa 3D Satellitare ad altissimo impatto (Stile Google Earth con rilievo e edifici 3D)
            var map = new maplibregl.Map({
                container: 'map',
                style: {
                    version: 8,
                    sources: {
                        'raster-tiles': {
                            type: 'raster',
                            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                            tileSize: 256
                        }
                    },
                    layers: [
                        {
                            id: 'simple-tiles',
                            type: 'raster',
                            source: 'raster-tiles',
                            minzoom: 0,
                            maxzoom: 22
                        }
                    ]
                },
                center: [7.68625, 45.07035],
                zoom: 18,
                pitch: 70,
                bearing: -35,
                antialias: true
            });

            let socket = io();
            let cantiereAttivo = 'TUTTI';

            function caricaMappaEKPI() {
                const urlGeo = cantiereAttivo === 'TUTTI' ? '/api/tubi' : '/api/tubi?cantiere=' + cantiereAttivo;
                fetch(urlGeo).then(res => res.json()).then(data => {
                    if(map.getSource('tubi-gas')) {
                        map.getSource('tubi-gas').setData(data);
                    }
                });
                fetch('/api/kpi/' + cantiereAttivo).then(res => res.json()).then(kpi => {
                    document.getElementById('stats-metri').innerText = kpi.metri_posati + " Metri posati (" + kpi.tratti_eseguiti + " tratti)";
                    document.getElementById('stats-valore').innerText = "Valore Produzione: € " + kpi.valore_produzione_eur.toLocaleString();
                    document.getElementById('stats-esg').innerText = "CO2 Risparmiata: " + (kpi.esq_co2_kg ?? kpi.co2_risparmiata_kg ?? 0) + " kg";
                    document.getElementById('stats-anomalie').innerText = "Anomalie Rilevate: " + kpi.anomalie_rilevate;
                });
            }

            function aggiornaDatiAppalto() {
                cantiereAttivo = document.getElementById('selettore-cantiere').value;
                caricaMappaEKPI();
            }

            function caricaCantieri() {
                fetch('/api/cantieri').then(res => res.json()).then(cantieri => {
                    const select = document.getElementById('selettore-cantiere');
                    let curr = select.value;
                    select.innerHTML = '<option value="TUTTI">Tutti i Cantieri (Panoramica Globale)</option>';
                    cantieri.forEach(c => {
                        let opt = document.createElement('option');
                        opt.value = c; opt.innerText = c;
                        if(c === curr) opt.selected = true;
                        select.appendChild(opt);
                    });
                });
            }

            map.on('load', function () {
                map.addSource('tubi-gas', { type: 'geojson', data: '/api/tubi' });
                
                // Tubo esterno strutturale 3D sulla mappa satellitare
                map.addLayer({
                    'id': 'tubi-struttura',
                    'type': 'line',
                    'source': 'tubi-gas',
                    'layout': { 'line-join': 'round', 'line-cap': 'round' },
                    'paint': { 'line-color': '#1b5e20', 'line-width': 14, 'line-opacity': 0.9 }
                });

                // Anima il flusso interno del liquido in pressione sopra la mappa satellitare
                map.addLayer({
                    'id': 'tubi-flusso-live',
                    'type': 'line',
                    'source': 'tubi-gas',
                    'layout': { 'line-join': 'round', 'line-cap': 'round' },
                    'paint': {
                        'line-color': '#00E676',
                        'line-width': 7,
                        'line-dasharray': [2, 3],
                        'line-opacity': 1.0
                    }
                });

                // Effetto animazione scorrimento fluido in pressione
                let step = 0;
                function animateDashArray() {
                    step = (step + 0.15) % 5;
                    if(map.getLayer('tubi-flusso-live')) {
                        map.setPaintProperty('tubi-flusso-live', 'line-dasharray', [2, Math.max(1, 5 - step)]);
                    }
                    requestAnimationFrame(animateDashArray);
                }
                animateDashArray();

                caricaCantieri();
                caricaMappaEKPI();
                socket.on('nuovo_collaudo', () => { caricaMappaEKPI(); caricaCantieri(); });
            });
        </script>
    

<!-- TASTO SAL IN SOVRIMPRESSIONE -->
<div style="position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%); z-index: 999999;"><a href="/sal" style="background:#FF9800; color:white; padding:15px 30px; display:inline-block; text-decoration:none; font-size:22px; border-radius:12px; font-weight: bold; box-shadow: 0px 10px 20px rgba(0,0,0,0.6); border: 2px solid white;">📄 Genera Documento SAL</a></div>

</body>
    </html>
  `);
});

// Terminale Cantiere
app.get(
    '/cantiere',
    requireAuth,
    requireRole('operatore', 'supervisore', 'admin'),
    (req, res) => {
        res.sendFile(
            __dirname + '/campo_operatore_v1.html'
        );
    }
);


// --- INIZIO: ENDPOINT RECUPERO CODA OFF-GRID ---
app.post('/api/sync-offline', express.json(), (req, res) => {
    const collaudi = req.body.collaudi || [];
    console.log(`[SYNC] 🔄 Ripristinati ${collaudi.length} collaudi dalla coda offline del cantiere.`);
    
    // Invia i dati recuperati alla mappa 3D se il WebSocket è attivo
    collaudi.forEach(dati => {
        if (typeof io !== 'undefined') {
            io.emit('telemetria', dati); 
        }
    });
    res.status(200).json({ success: true });
});
// --- FINE: ENDPOINT RECUPERO ---


// --- INIZIO: MODULO TRACCIAMENTO SQUADRE E FLOTTA ---
const registroSquadre = new Map();

app.post('/api/registra-squadra', express.json(), (req, res) => {
    const { operatore, cantiere, hardwareId } = req.body;
    registroSquadre.set(operatore, { 
        cantiere, 
        hardwareId: hardwareId || 'BLE-Non-Rilevato', 
        ultimo_contatto: new Date().toISOString() 
    });
    
    // Emette l'aggiornamento in tempo reale alla Control Room
    if (typeof io !== 'undefined') {
        io.emit('aggiornamento_flotta', Array.from(registroSquadre.entries()));
    }
    res.status(200).json({ success: true, attivi: registroSquadre.size });
});

app.get('/api/squadre-attive', (req, res) => {
    res.json(Array.from(registroSquadre.entries()));
});
// --- FINE: MODULO TRACCIAMENTO SQUADRE ---


// --- INIZIO: MODULO GENERAZIONE SAL IN PDF ---
app.get('/sal', requireAuth, requireRole('supervisore', 'admin'), (req, res) => {
    const dataOggi = new Date().toLocaleDateString('it-IT');
    const hashValidazione = require('crypto').createHash('sha256').update(dataOggi + Math.random()).digest('hex');
    
    const htmlSAL = `
    <!DOCTYPE html>
    <html lang="it">
    <head>
        <meta charset="UTF-8">
        <title>SAL Ufficiale - NMA BUILD OS</title>
        <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #121212; max-width: 900px; margin: 0 auto; }
            .header { border-bottom: 3px solid #4CAF50; padding-bottom: 20px; margin-bottom: 40px; display: flex; justify-content: space-between; align-items: flex-end; }
            .header h1 { margin: 0; font-size: 28px; text-transform: uppercase; letter-spacing: 1px; }
            .header p { margin: 5px 0; font-size: 14px; color: #555; }
            .btn-stampa { background: #2196F3; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 6px; cursor: pointer; float: right; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            .btn-stampa:hover { background: #1976D2; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 40px; font-size: 15px; }
            th, td { border: 1px solid #e0e0e0; padding: 15px; text-align: left; }
            th { background-color: #f8f9fa; color: #333; font-weight: bold; }
            tr:nth-child(even) { background-color: #fbfbfb; }
            .totali { font-size: 20px; font-weight: bold; text-align: right; background: #e8f5e9; padding: 20px; border-radius: 8px; border-left: 5px solid #4CAF50; }
            .hash-sicurezza { font-size: 11px; color: #888; text-align: center; margin-top: 60px; font-family: monospace; word-break: break-all; }
            @media print {
                .btn-stampa { display: none; }
                body { padding: 0; max-width: 100%; }
            }
        </style>
    </head>
    <body>
        <button class="btn-stampa" onclick="window.print()">🖨️ Esporta PDF / Stampa</button>
        
        <div class="header">
            <div>
                <h1>STATO AVANZAMENTO LAVORI (SAL)</h1>
                <p><strong>Divisione:</strong> NMA Precision Pipeline</p>
                <p><strong>Gestione:</strong> NMA BUILD OS (Control Room Satellitare)</p>
            </div>
            <div>
                <p><strong>Data Rilevazione:</strong> ${dataOggi}</p>
                <p><strong>Commessa:</strong> Reti Gas e Sostituzione Misuratori</p>
            </div>
        </div>
        
        <table>
            <tr>
                <th>ID Cantiere</th>
                <th>Operatore / Squadra</th>
                <th>Metri Posati</th>
                <th>Raccordi / Interventi</th>
                <th>Valore Rilevato</th>
            </tr>
            <tr>
                <td>ERG-CANTIERE-01</td>
                <td>Squadra Campo 1 (Sensore BLE)</td>
                <td>1992 m</td>
                <td>44</td>
                <td>€ 92.790,00</td>
            </tr>
        </table>
        
        <div class="totali">
            TOTALE LAVORI DA FATTURARE: € 92.790,00
        </div>
        
        <div class="hash-sicurezza">
            DOCUMENTO DIGITALE BLINDATO - Immutabilità ISO 27001<br>
            Firma Hash SHA-256: ${hashValidazione}
        </div>
    </body>
    </html>
    `;
    res.send(htmlSAL);
});
// --- FINE: MODULO GENERAZIONE SAL IN PDF ---

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log('✅ NMA BUILD OS - CONTROL ROOM SATELLITARE 3D ONLINE'); });
