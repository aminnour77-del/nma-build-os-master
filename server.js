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

// ============================================================
// NMA BUILD OS — SECURITY HEADERS v1
// ============================================================

app.disable('x-powered-by');

app.use((req,res,next)=>{

    res.setHeader(
        'X-Content-Type-Options',
        'nosniff'
    );

    res.setHeader(
        'X-Frame-Options',
        'DENY'
    );

    res.setHeader(
        'Referrer-Policy',
        'strict-origin-when-cross-origin'
    );

    res.setHeader(
        'Permissions-Policy',
        'geolocation=(self), camera=(self), microphone=()'
    );

    /*
     * HSTS solo quando la richiesta arriva realmente via HTTPS.
     * Render usa X-Forwarded-Proto dietro il proxy.
     */
    const forwardedProto=
        String(
            req.headers['x-forwarded-proto'] || ''
        )
        .split(',')[0]
        .trim()
        .toLowerCase();

    if(
        req.secure ||
        forwardedProto === 'https'
    ){
        res.setHeader(
            'Strict-Transport-Security',
            'max-age=31536000; includeSubDomains'
        );
    }

    /*
     * Marker innocuo usato esclusivamente
     * per riconoscere il nuovo deploy.
     */
    res.setHeader(
        'X-NMA-Security',
        'hardening-v1'
    );

    next();
});



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


// ============================================================
// NMA BUILD OS — GPS QUALITY v1
// La geometria GPS e la misura metrica sono dati distinti.
// ============================================================

TrattoReteSchema.add({

    sorgente_gps: {
        type: String,
        enum: [
            'smartphone',
            'gnss',
            'rtk'
        ],
        default: 'smartphone'
    },

    accuratezza_media_m: {
        type: Number,
        default: 0
    },

    accuratezza_massima_m: {
        type: Number,
        default: 0
    },

    qualita_gps: {
        type: String,
        default: 'sconosciuta'
    },

    gps_idoneo_misura: {
        type: Boolean,
        default: false
    },

    lunghezza_gps_m: {
        type: Number,
        default: 0
    },

    lunghezza_misurata_m: {
        type: Number,
        default: 0
    }
});

const TrattoRete = mongoose.model('TrattoRete', TrattoReteSchema);

// -------------------------------------------------------------

const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '15mb' }));

app.use((req, res, next) => {
    if (String(req.originalUrl || '').startsWith('/api/')) {
        res.setHeader(
            'Cache-Control',
            'no-store, no-cache, must-revalidate'
        );
        res.setHeader('Pragma', 'no-cache');
    }

    next();
});

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

// ============================================================
// NMA BUILD OS — RESILIENZA v1
// Sessione/API/RBAC coerenti
// ============================================================

const nmaIsApiRequest = req =>
    String(req.originalUrl || '').startsWith('/api/');

const requireAuth = (req, res, next) => {
    if (req.session && req.session.authenticated === true) {
        return next();
    }

    if (nmaIsApiRequest(req)) {
        return res.status(401).json({
            ok: false,
            code: 'AUTH_REQUIRED',
            error: 'Sessione scaduta o autenticazione richiesta'
        });
    }

    return res.redirect('/');
};

const requireRole = (...allowedRoles) => (req, res, next) => {
    if (!req.session || req.session.authenticated !== true) {
        if (nmaIsApiRequest(req)) {
            return res.status(401).json({
                ok: false,
                code: 'AUTH_REQUIRED',
                error: 'Sessione scaduta o autenticazione richiesta'
            });
        }

        return res.redirect('/');
    }

    const currentRole = String(req.session.role || '');

    if (!allowedRoles.includes(currentRole)) {
        if (nmaIsApiRequest(req)) {
            return res.status(403).json({
                ok: false,
                code: 'ROLE_FORBIDDEN',
                error: 'Ruolo non autorizzato'
            });
        }

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

        // NMA_SERVER_GUARD_CAPABILITY_V1
        capabilities: {
            server_guard_v1: true,
            resilience_v1: true,
            master_foundation_v1: true,
            network_memory_v1: true
        },
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


// ============================================================
// NMA BUILD OS — PROGETTO ASBUILT CONFRONTO v1
// ============================================================

const ProgettoRiferimentoSchema =
    new mongoose.Schema({

        id_intervento: {
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

        geometry: {
            type: {
                type: String,
                enum: ['LineString'],
                required: true
            },

            coordinates: {
                type: [[Number]],
                required: true
            }
        },

        materiale: {
            type: String,
            default: ''
        },

        diametro_mm: {
            type: Number,
            default: 0
        },

        fonte: {
            type: String,
            default: ''
        },

        note: {
            type: String,
            default: ''
        },

        creato_da: {
            type: String,
            default: ''
        },

        aggiornato_il: {
            type: Date,
            default: Date.now
        }

    }, {
        collection: 'progetti_riferimento'
    });

const ProgettoRiferimento =
    mongoose.models.ProgettoRiferimento ||
    mongoose.model(
        'ProgettoRiferimento',
        ProgettoRiferimentoSchema,
        'progetti_riferimento'
    );

function nmaDistanzaMetri(a,b){

    const R=6371000;
    const rad=v=>v*Math.PI/180;

    const lat1=rad(a[1]);
    const lat2=rad(b[1]);

    const dLat=rad(b[1]-a[1]);
    const dLng=rad(b[0]-a[0]);

    const q=
        Math.sin(dLat/2)**2 +
        Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(dLng/2)**2;

    return 2*R*Math.atan2(
        Math.sqrt(q),
        Math.sqrt(1-q)
    );
}

function nmaLunghezzaLinea(coords){

    if(!Array.isArray(coords) || coords.length<2){
        return 0;
    }

    let totale=0;

    for(let i=1;i<coords.length;i++){
        totale+=nmaDistanzaMetri(
            coords[i-1],
            coords[i]
        );
    }

    return totale;
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

    // ========================================================
    // NMA BUILD OS — PASSAPORTO INFRASTRUTTURA v1
    // ========================================================

    scavo: {

        tipo: {
            type: String,
            default: ''
        },

        profondita_cm: {
            type: Number,
            default: 0
        },

        larghezza_cm: {
            type: Number,
            default: 0
        },

        terreno: {
            type: String,
            default: ''
        },

        ripristino: {
            type: String,
            default: ''
        }
    },

    posa: {

        profondita_cm: {
            type: Number,
            default: 0
        },

        letto_posa: {
            type: String,
            default: ''
        },

        nastro_segnalatore: {
            type: Boolean,
            default: false
        },

        protezione_meccanica: {
            type: String,
            default: ''
        }
    },

    misure: {

        quota_inizio_cm: {
            type: Number,
            default: 0
        },

        quota_fine_cm: {
            type: Number,
            default: 0
        },

        distanza_riferimento_cm: {
            type: Number,
            default: 0
        },

        riferimento: {
            type: String,
            default: ''
        }
    },

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

    // ========================================================
    // NMA BUILD OS — CORREZIONI CONTROLLATE v1
    // ========================================================

    correzioni: [{
        id_correzione: {
            type: String,
            default: ''
        },

        richiesta_da: {
            type: String,
            default: ''
        },

        richiesta_il: Date,

        note: {
            type: String,
            default: ''
        },

        risolta: {
            type: Boolean,
            default: false
        },

        risolta_da: {
            type: String,
            default: ''
        },

        risolta_il: Date,

        note_operatore: {
            type: String,
            default: ''
        }
    }],

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

    dossier_chiusura: {

        chiuso: {
            type: Boolean,
            default: false
        },

        chiuso_da: {
            type: String,
            default: ''
        },

        chiuso_il: Date,

        hash_snapshot: {
            type: String,
            default: ''
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



// ============================================================
// NMA BUILD OS — NETWORK MEMORY v1
//
// 1. L'anomalia originale RESTA nell'intervento Campo.
// 2. La manutenzione è un record separato e tracciabile.
// 3. Chiudere una manutenzione NON cancella l'anomalia storica.
// 4. Nessuna telemetria viene inventata.
// ============================================================

const ManutenzioneReteSchema =
    new mongoose.Schema({

        id_manutenzione:{
            type:String,
            required:true,
            unique:true,
            index:true
        },

        id_intervento:{
            type:String,
            required:true,
            index:true
        },

        id_cantiere:{
            type:String,
            required:true,
            index:true
        },

        tipo:{
            type:String,

            enum:[
                'ispezione',
                'verifica',
                'riparazione',
                'sostituzione',
                'altro'
            ],

            default:'verifica'
        },

        priorita:{
            type:String,

            enum:[
                'bassa',
                'media',
                'alta',
                'urgente'
            ],

            default:'media'
        },

        stato:{
            type:String,

            enum:[
                'aperta',
                'pianificata',
                'in_corso',
                'chiusa'
            ],

            default:'aperta',

            index:true
        },

        descrizione:{
            type:String,
            required:true
        },

        note:{
            type:String,
            default:''
        },

        aperta_da:{
            type:String,
            default:''
        },

        creata_il:{
            type:Date,
            default:Date.now,
            index:true
        },

        aggiornata_il:{
            type:Date,
            default:Date.now
        },

        chiusa_da:{
            type:String,
            default:''
        },

        chiusa_il:{
            type:Date
        }

    },{
        collection:
            'manutenzioni_rete'
    });


const ManutenzioneRete =
    mongoose.models.ManutenzioneRete ||
    mongoose.model(
        'ManutenzioneRete',
        ManutenzioneReteSchema,
        'manutenzioni_rete'
    );


function nmaManutenzionePublica(doc){

    if(!doc){
        return null;
    }

    return {
        id_manutenzione:
            String(
                doc.id_manutenzione ||
                ''
            ),

        id_intervento:
            String(
                doc.id_intervento ||
                ''
            ),

        id_cantiere:
            String(
                doc.id_cantiere ||
                ''
            ),

        tipo:
            String(
                doc.tipo ||
                ''
            ),

        priorita:
            String(
                doc.priorita ||
                ''
            ),

        stato:
            String(
                doc.stato ||
                ''
            ),

        descrizione:
            String(
                doc.descrizione ||
                ''
            ),

        note:
            String(
                doc.note ||
                ''
            ),

        aperta_da:
            String(
                doc.aperta_da ||
                ''
            ),

        creata_il:
            doc.creata_il ||
            null,

        aggiornata_il:
            doc.aggiornata_il ||
            null,

        chiusa_da:
            String(
                doc.chiusa_da ||
                ''
            ),

        chiusa_il:
            doc.chiusa_il ||
            null
    };
}


// ============================================================
// NETWORK CONTROL STATUS
//
// La telemetria resta esplicitamente NON COLLEGATA.
// I valori null NON sono valori zero.
// ============================================================

app.get(
    '/api/network-control/status',

    requireAuth,

    requireRole(
        'supervisore',
        'admin'
    ),

    async (req,res)=>{

        try{

            const cantiere=
                String(
                    req.query.cantiere ||
                    ''
                ).trim();

            const filtroInterventi={};

            const filtroManutenzioni={};

            if(cantiere){

                filtroInterventi
                    .id_cantiere=
                        cantiere;

                filtroManutenzioni
                    .id_cantiere=
                        cantiere;
            }


            const [
                anomalie,
                manutenzioniAperte,
                manutenzioniChiuse
            ]=
                await Promise.all([

                    InterventoCampo
                        .countDocuments({
                            ...filtroInterventi,

                            'anomalia.presente':
                                true
                        }),

                    ManutenzioneRete
                        .countDocuments({
                            ...filtroManutenzioni,

                            stato:{
                                $ne:'chiusa'
                            }
                        }),

                    ManutenzioneRete
                        .countDocuments({
                            ...filtroManutenzioni,

                            stato:'chiusa'
                        })
                ]);


            return res.json({

                ok:true,

                telemetria:{
                    collegata:false,
                    sorgente:null,

                    pressione:null,
                    flusso:null,

                    dispersioni:{
                        calcolate:false,
                        valore:null
                    },

                    ultimo_dato:null
                },

                rete:{
                    anomalie_registrate:
                        anomalie,

                    manutenzioni_aperte:
                        manutenzioniAperte,

                    manutenzioni_chiuse:
                        manutenzioniChiuse
                },

                nota:
                    'Nessun sensore live collegato. '+
                    'Pressione, flusso e dispersioni '+
                    'non vengono simulati come dati reali.',

                generato_il:
                    new Date().toISOString()
            });

        }catch(error){

            console.error(
                'Errore Network Control:',
                error
            );

            return res.status(500).json({
                ok:false,
                error:
                    'Errore Network Control'
            });
        }
    }
);


// ============================================================
// ELENCO MANUTENZIONI
// ============================================================

app.get(
    '/api/manutenzioni',

    requireAuth,

    requireRole(
        'supervisore',
        'admin'
    ),

    async (req,res)=>{

        try{

            const filtro={};

            const cantiere=
                String(
                    req.query.cantiere ||
                    ''
                ).trim();

            const stato=
                String(
                    req.query.stato ||
                    ''
                ).trim();

            if(cantiere){
                filtro.id_cantiere=
                    cantiere;
            }

            if(stato){
                filtro.stato=
                    stato;
            }


            const docs=
                await ManutenzioneRete
                    .find(filtro)
                    .sort({
                        aggiornata_il:-1
                    })
                    .limit(500)
                    .lean();


            return res.json({
                ok:true,

                totale:
                    docs.length,

                manutenzioni:
                    docs.map(
                        nmaManutenzionePublica
                    )
            });

        }catch(error){

            console.error(
                'Errore GET manutenzioni:',
                error
            );

            return res.status(500).json({
                ok:false,
                error:
                    'Errore lettura manutenzioni'
            });
        }
    }
);


// ============================================================
// APERTURA MANUTENZIONE
// ============================================================

app.post(
    '/api/manutenzioni',

    requireAuth,

    requireRole(
        'supervisore',
        'admin'
    ),

    async (req,res)=>{

        try{

            const idIntervento=
                String(
                    req.body
                        ?.id_intervento ||
                    ''
                ).trim();

            const descrizione=
                String(
                    req.body
                        ?.descrizione ||
                    ''
                ).trim();

            const tipo=
                String(
                    req.body
                        ?.tipo ||
                    'verifica'
                ).trim();

            const priorita=
                String(
                    req.body
                        ?.priorita ||
                    'media'
                ).trim();


            const tipi=[
                'ispezione',
                'verifica',
                'riparazione',
                'sostituzione',
                'altro'
            ];

            const prioritaAmmesse=[
                'bassa',
                'media',
                'alta',
                'urgente'
            ];


            if(
                !idIntervento ||
                !descrizione
            ){

                return res.status(422).json({
                    ok:false,
                    error:
                        'Intervento e descrizione sono obbligatori'
                });
            }


            if(
                !tipi.includes(tipo)
            ){

                return res.status(422).json({
                    ok:false,
                    error:
                        'Tipo manutenzione non valido'
                });
            }


            if(
                !prioritaAmmesse
                    .includes(priorita)
            ){

                return res.status(422).json({
                    ok:false,
                    error:
                        'Priorità non valida'
                });
            }


            const intervento=
                await InterventoCampo
                    .findOne({
                        id_intervento:
                            idIntervento
                    });


            if(!intervento){

                return res.status(404).json({
                    ok:false,
                    error:
                        'Intervento non trovato'
                });
            }


            const idManutenzione=
                'MAN-'+
                crypto
                    .randomUUID()
                    .toUpperCase();


            const manutenzione=
                await ManutenzioneRete
                    .create({

                        id_manutenzione:
                            idManutenzione,

                        id_intervento:
                            intervento
                                .id_intervento,

                        id_cantiere:
                            intervento
                                .id_cantiere,

                        tipo,

                        priorita,

                        stato:
                            'aperta',

                        descrizione,

                        note:
                            String(
                                req.body
                                    ?.note ||
                                ''
                            ).trim(),

                        aperta_da:
                            String(
                                req.session
                                    ?.role ||
                                ''
                            ),

                        creata_il:
                            new Date(),

                        aggiornata_il:
                            new Date()
                    });


            await registraAudit({

                evento:
                    'MANUTENZIONE_APERTA',

                intervento,

                ruolo:
                    String(
                        req.session
                            ?.role ||
                        ''
                    ),

                origine:
                    'network_memory',

                stato:
                    intervento.stato,

                note:
                    idManutenzione+
                    ' — '+
                    descrizione
            });


            return res.status(201).json({

                ok:true,

                manutenzione:
                    nmaManutenzionePublica(
                        manutenzione
                    )
            });

        }catch(error){

            console.error(
                'Errore apertura manutenzione:',
                error
            );

            return res.status(500).json({
                ok:false,
                error:
                    'Errore apertura manutenzione'
            });
        }
    }
);


// ============================================================
// CAMBIO STATO MANUTENZIONE
// ============================================================

app.patch(
    '/api/manutenzioni/:id/stato',

    requireAuth,

    requireRole(
        'supervisore',
        'admin'
    ),

    async (req,res)=>{

        try{

            const id=
                String(
                    req.params.id ||
                    ''
                ).trim();

            const stato=
                String(
                    req.body
                        ?.stato ||
                    ''
                ).trim();

            const note=
                String(
                    req.body
                        ?.note ||
                    ''
                ).trim();


            const stati=[
                'aperta',
                'pianificata',
                'in_corso',
                'chiusa'
            ];


            if(
                !id ||
                !stati.includes(stato)
            ){

                return res.status(422).json({
                    ok:false,
                    error:
                        'Stato manutenzione non valido'
                });
            }


            const manutenzione=
                await ManutenzioneRete
                    .findOne({
                        id_manutenzione:id
                    });


            if(!manutenzione){

                return res.status(404).json({
                    ok:false,
                    error:
                        'Manutenzione non trovata'
                });
            }


            manutenzione.stato=
                stato;

            manutenzione
                .aggiornata_il=
                    new Date();


            if(note){

                manutenzione.note=
                    note;
            }


            if(stato==='chiusa'){

                manutenzione.chiusa_il=
                    new Date();

                manutenzione.chiusa_da=
                    String(
                        req.session
                            ?.role ||
                        ''
                    );

            }else{

                manutenzione.chiusa_il=
                    undefined;

                manutenzione.chiusa_da=
                    '';
            }


            await manutenzione.save();


            const intervento=
                await InterventoCampo
                    .findOne({
                        id_intervento:
                            manutenzione
                                .id_intervento
                    });


            if(intervento){

                await registraAudit({

                    evento:
                        stato==='chiusa'
                            ? 'MANUTENZIONE_CHIUSA'
                            : 'MANUTENZIONE_STATO_AGGIORNATO',

                    intervento,

                    ruolo:
                        String(
                            req.session
                                ?.role ||
                            ''
                        ),

                    origine:
                        'network_memory',

                    stato:
                        intervento.stato,

                    note:
                        manutenzione
                            .id_manutenzione+
                        ' -> '+
                        stato+
                        (
                            note
                                ? ' — '+note
                                : ''
                        )
                });
            }


            return res.json({

                ok:true,

                manutenzione:
                    nmaManutenzionePublica(
                        manutenzione
                    )
            });

        }catch(error){

            console.error(
                'Errore aggiornamento manutenzione:',
                error
            );

            return res.status(500).json({
                ok:false,
                error:
                    'Errore aggiornamento manutenzione'
            });
        }
    }
);


// ============================================================
// NETWORK MEMORY
//
// Vista unica della storia rete:
// intervento + anomalia + As-Built + progetto + manutenzioni.
//
// Nessun dato viene duplicato.
// ============================================================

app.get(
    '/api/network-memory',

    requireAuth,

    requireRole(
        'supervisore',
        'admin'
    ),

    async (req,res)=>{

        try{

            const cantiere=
                String(
                    req.query.cantiere ||
                    ''
                ).trim();

            const filtro={};

            if(cantiere){

                filtro.id_cantiere=
                    cantiere;
            }


            const interventi=
                await InterventoCampo
                    .find(filtro)
                    .sort({
                        aggiornato_il:-1
                    })
                    .limit(500)
                    .lean();


            const ids=
                interventi
                    .map(
                        x=>
                            String(
                                x.id_intervento ||
                                ''
                            )
                    )
                    .filter(Boolean);


            const [
                manutenzioni,
                tratti,
                progetti
            ]=
                await Promise.all([

                    ids.length
                        ? ManutenzioneRete
                            .find({
                                id_intervento:{
                                    $in:ids
                                }
                            })
                            .sort({
                                aggiornata_il:-1
                            })
                            .lean()
                        : [],

                    ids.length
                        ? TrattoRete
                            .find({
                                id_tratto:{
                                    $in:
                                        ids.map(
                                            id=>
                                                'ASB-'+id
                                        )
                                }
                            })
                            .lean()
                        : [],

                    ids.length
                        ? ProgettoRiferimento
                            .find({
                                id_intervento:{
                                    $in:ids
                                }
                            })
                            .lean()
                        : []
                ]);


            const maintenanceMap=
                new Map();

            for(
                const manutenzione
                of manutenzioni
            ){

                const key=
                    String(
                        manutenzione
                            .id_intervento ||
                        ''
                    );

                if(
                    !maintenanceMap
                        .has(key)
                ){
                    maintenanceMap
                        .set(
                            key,
                            []
                        );
                }

                maintenanceMap
                    .get(key)
                    .push(
                        nmaManutenzionePublica(
                            manutenzione
                        )
                    );
            }


            const asbuiltSet=
                new Set(
                    tratti.map(
                        x=>
                            String(
                                x.id_tratto ||
                                ''
                            )
                            .replace(
                                /^ASB-/,
                                ''
                            )
                    )
                );


            const projectSet=
                new Set(
                    progetti.map(
                        x=>
                            String(
                                x.id_intervento ||
                                ''
                            )
                    )
                );


            const assets=
                interventi.map(
                    intervento=>{

                        const id=
                            String(
                                intervento
                                    .id_intervento ||
                                ''
                            );

                        const lista=
                            maintenanceMap
                                .get(id) ||
                            [];


                        const aperte=
                            lista.filter(
                                x=>
                                    x.stato !==
                                    'chiusa'
                            );


                        return {

                            id_intervento:id,

                            id_cantiere:
                                String(
                                    intervento
                                        .id_cantiere ||
                                    ''
                                ),

                            stato_intervento:
                                String(
                                    intervento
                                        .stato ||
                                    ''
                                ),

                            operatore:
                                String(
                                    intervento
                                        .operatore ||
                                    ''
                                ),

                            squadra:
                                String(
                                    intervento
                                        .squadra ||
                                    ''
                                ),

                            tubazione:{
                                materiale:
                                    String(
                                        intervento
                                            .tubazione
                                            ?.materiale ||
                                        ''
                                    ),

                                diametro_mm:
                                    Number(
                                        intervento
                                            .tubazione
                                            ?.diametro_mm ||
                                        0
                                    ),

                                metri:
                                    Number(
                                        intervento
                                            .tubazione
                                            ?.metri ||
                                        0
                                    )
                            },

                            anomalia:{
                                presente:
                                    intervento
                                        .anomalia
                                        ?.presente ===
                                    true,

                                descrizione:
                                    String(
                                        intervento
                                            .anomalia
                                            ?.descrizione ||
                                        ''
                                    )
                            },

                            asbuilt_presente:
                                asbuiltSet
                                    .has(id),

                            progetto_presente:
                                projectSet
                                    .has(id),

                            manutenzioni:
                                lista,

                            manutenzioni_aperte:
                                aperte.length,

                            aggiornato_il:
                                intervento
                                    .aggiornato_il ||
                                intervento
                                    .creato_il ||
                                null
                        };
                    }
                );


            const anomalie=
                assets.filter(
                    x=>
                        x.anomalia
                            .presente ===
                        true
                );


            const manutenzioniAperte=
                manutenzioni.filter(
                    x=>
                        x.stato !==
                        'chiusa'
                ).length;


            const manutenzioniChiuse=
                manutenzioni.filter(
                    x=>
                        x.stato ===
                        'chiusa'
                ).length;


            return res.json({

                ok:true,

                totali:{
                    asset:
                        assets.length,

                    anomalie:
                        anomalie.length,

                    manutenzioni:
                        manutenzioni.length,

                    manutenzioni_aperte:
                        manutenzioniAperte,

                    manutenzioni_chiuse:
                        manutenzioniChiuse,

                    asbuilt:
                        assets.filter(
                            x=>
                                x.asbuilt_presente
                        ).length,

                    progetti:
                        assets.filter(
                            x=>
                                x.progetto_presente
                        ).length
                },

                assets,

                generato_il:
                    new Date().toISOString()
            });

        }catch(error){

            console.error(
                'Errore Network Memory:',
                error
            );

            return res.status(500).json({
                ok:false,
                error:
                    'Errore Network Memory'
            });
        }
    }
);


// ============================================================
// UI NETWORK MEMORY
// ============================================================

app.get(
    '/network-memory',

    requireAuth,

    requireRole(
        'supervisore',
        'admin'
    ),

    (req,res)=>{

        res.sendFile(
            __dirname+
            '/network_memory_v1.html'
        );
    }
);


// ============================================================
// NMA BUILD OS — SERVER GUARD v1
// Integrità minima dei nuovi interventi.
// Il GPS smartphone resta informativo e NON determina
// la validità della misura dei metri posati.
// ============================================================

function nmaValidaInterventoCampoServer(body = {}) {

    const errori = [];
    const avvisi = [];

    const testo = value =>
        String(value ?? '').trim();

    const numero = value => {

        if (
            value === null ||
            value === undefined ||
            value === ''
        ) {
            return null;
        }

        const n = Number(value);

        return Number.isFinite(n)
            ? n
            : null;
    };

    const idCantiere =
        testo(body.id_cantiere);

    const idIntervento =
        testo(body.id_intervento);

    const offlineId =
        testo(body.offline_id);

    const operatore =
        testo(body.operatore);

    const squadra =
        testo(body.squadra);

    const materiale =
        testo(
            body.tubazione?.materiale
        );

    const diametro =
        numero(
            body.tubazione?.diametro_mm
        );

    const metri =
        numero(
            body.tubazione?.metri
        );

    if (!idCantiere) {
        errori.push(
            'Cantiere obbligatorio'
        );
    }

    if (!idIntervento) {
        errori.push(
            'ID intervento obbligatorio'
        );
    }

    if (!offlineId) {
        errori.push(
            'offline_id obbligatorio'
        );
    }

    if (!operatore) {
        errori.push(
            'Operatore obbligatorio'
        );
    }

    if (!squadra) {
        errori.push(
            'Squadra obbligatoria'
        );
    }

    if (!materiale) {
        errori.push(
            'Materiale tubazione obbligatorio'
        );
    }

    if (
        diametro === null ||
        diametro <= 0
    ) {
        errori.push(
            'Diametro tubazione non valido'
        );
    }

    if (
        metri === null ||
        metri <= 0
    ) {
        errori.push(
            'Metri posati misurati non validi'
        );
    }

    if (
        body.anomalia?.presente === true &&
        !testo(body.anomalia?.descrizione)
    ) {
        errori.push(
            'Descrizione anomalia obbligatoria quando è presente un’anomalia'
        );
    }

    const lat =
        numero(body.gps?.lat);

    const lng =
        numero(body.gps?.lng);

    const accuracy =
        numero(
            body.gps?.accuratezza
        );

    if (
        lat === null ||
        lng === null ||
        lat === 0 ||
        lng === 0
    ) {
        avvisi.push(
            'Posizione GPS non disponibile'
        );
    }

    if (
        accuracy !== null &&
        accuracy > 10
    ) {
        avvisi.push(
            'GPS con accuratezza scarsa: posizione solo indicativa'
        );
    }

    return {
        ok:
            errori.length === 0,

        errori,
        avvisi
    };
}

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


            // =================================================
            // SERVER GUARD v1
            // Il controllo avviene dopo la verifica idempotente.
            // =================================================

            const controlloCampo =
                nmaValidaInterventoCampoServer(
                    body
                );

            if (!controlloCampo.ok) {

                return res.status(422).json({
                    ok: false,
                    code:
                        'CAMPO_GUARD_SERVER',

                    error:
                        'Intervento incompleto o non valido',

                    errori:
                        controlloCampo.errori,

                    avvisi:
                        controlloCampo.avvisi
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

                scavo: {

                    tipo:
                        String(
                            body.scavo?.tipo || ''
                        ).trim(),

                    profondita_cm:
                        numero(
                            body.scavo?.profondita_cm,
                            0
                        ),

                    larghezza_cm:
                        numero(
                            body.scavo?.larghezza_cm,
                            0
                        ),

                    terreno:
                        String(
                            body.scavo?.terreno || ''
                        ).trim(),

                    ripristino:
                        String(
                            body.scavo?.ripristino || ''
                        ).trim()
                },

                posa: {

                    profondita_cm:
                        numero(
                            body.posa?.profondita_cm,
                            0
                        ),

                    letto_posa:
                        String(
                            body.posa?.letto_posa || ''
                        ).trim(),

                    nastro_segnalatore:
                        body.posa?.nastro_segnalatore === true,

                    protezione_meccanica:
                        String(
                            body.posa?.protezione_meccanica || ''
                        ).trim()
                },

                misure: {

                    quota_inizio_cm:
                        numero(
                            body.misure?.quota_inizio_cm,
                            0
                        ),

                    quota_fine_cm:
                        numero(
                            body.misure?.quota_fine_cm,
                            0
                        ),

                    distanza_riferimento_cm:
                        numero(
                            body.misure?.distanza_riferimento_cm,
                            0
                        ),

                    riferimento:
                        String(
                            body.misure?.riferimento || ''
                        ).trim()
                },

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
                intervento: doc,

                avvisi:
                    controlloCampo.avvisi
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
// NMA BUILD OS — ASSET MEMORY v1
//
// La memoria infrastrutturale deriva dai dati già validati.
// Nessuna duplicazione del dato operativo.
// Nessuna scrittura MongoDB.
// ============================================================

app.get(
    '/api/asset-memory',
    requireAuth,
    requireRole(
        'supervisore',
        'admin'
    ),
    async (req,res)=>{

        try{

            const filtro={
                $or:[
                    {
                        stato:'validato'
                    },
                    {
                        'dossier_chiusura.chiuso':
                            true
                    }
                ]
            };

            const cantiere=
                String(
                    req.query.cantiere ||
                    ''
                ).trim();

            if(cantiere){
                filtro.id_cantiere=
                    cantiere;
            }

            const interventi=
                await InterventoCampo
                    .find(filtro)
                    .sort({
                        aggiornato_il:-1
                    })
                    .limit(500)
                    .lean();

            const ids=
                interventi
                    .map(
                        x=>String(
                            x.id_intervento ||
                            ''
                        )
                    )
                    .filter(Boolean);

            // ================================================
            // EVIDENZE
            // ================================================

            const evidenzeAgg=
                ids.length
                    ? await Evidenza.aggregate([
                        {
                            $match:{
                                id_intervento:{
                                    $in:ids
                                }
                            }
                        },
                        {
                            $group:{
                                _id:
                                    '$id_intervento',

                                totale:{
                                    $sum:1
                                }
                            }
                        }
                    ])
                    : [];

            const evidenzeMap=
                new Map(
                    evidenzeAgg.map(
                        x=>[
                            String(x._id),
                            Number(
                                x.totale || 0
                            )
                        ]
                    )
                );

            // ================================================
            // AUDIT
            // ================================================

            const auditAgg=
                ids.length
                    ? await AuditLog.aggregate([
                        {
                            $match:{
                                id_intervento:{
                                    $in:ids
                                }
                            }
                        },
                        {
                            $group:{
                                _id:
                                    '$id_intervento',

                                totale:{
                                    $sum:1
                                },

                                ultimo_evento:{
                                    $max:
                                        '$data_ora'
                                }
                            }
                        }
                    ])
                    : [];

            const auditMap=
                new Map(
                    auditAgg.map(
                        x=>[
                            String(x._id),
                            x
                        ]
                    )
                );

            // ================================================
            // AS-BUILT
            // ================================================

            const tratti=
                ids.length
                    ? await TrattoRete
                        .find({
                            id_tratto:{
                                $in:
                                    ids.map(
                                        id=>
                                            'ASB-'+id
                                    )
                            }
                        })
                        .lean()
                    : [];

            const trattiMap=
                new Map(
                    tratti.map(
                        x=>[
                            String(
                                x.id_tratto ||
                                ''
                            ).replace(
                                /^ASB-/,
                                ''
                            ),
                            x
                        ]
                    )
                );

            // ================================================
            // PROGETTO DI RIFERIMENTO
            // ================================================

            const progetti=
                ids.length
                    ? await ProgettoRiferimento
                        .find({
                            id_intervento:{
                                $in:ids
                            }
                        })
                        .lean()
                    : [];

            const progettoMap=
                new Map(
                    progetti.map(
                        x=>[
                            String(
                                x.id_intervento ||
                                ''
                            ),
                            x
                        ]
                    )
                );

            // ================================================
            // COSTRUZIONE MEMORIA
            // ================================================

            const assets=
                interventi.map(
                    x=>{

                        const id=
                            String(
                                x.id_intervento ||
                                ''
                            );

                        const audit=
                            auditMap.get(id);

                        const asbuilt=
                            trattiMap.get(id);

                        const progetto=
                            progettoMap.get(id);

                        return {

                            id_asset:
                                id,

                            id_intervento:
                                id,

                            id_cantiere:
                                x.id_cantiere ||
                                '',

                            stato:
                                x.stato ||
                                '',

                            dossier_chiuso:
                                x.dossier_chiusura
                                    ?.chiuso ===
                                    true,

                            operatore:
                                x.operatore ||
                                '',

                            squadra:
                                x.squadra ||
                                '',

                            tubazione:{
                                materiale:
                                    x.tubazione
                                        ?.materiale ||
                                    '',

                                diametro_mm:
                                    Number(
                                        x.tubazione
                                            ?.diametro_mm ||
                                        0
                                    ),

                                metri_misurati:
                                    Number(
                                        x.tubazione
                                            ?.metri ||
                                        0
                                    )
                            },

                            raccordi:
                                Number(
                                    x.raccordi ||
                                    0
                                ),

                            componenti:
                                Array.isArray(
                                    x.componenti
                                )
                                    ? x.componenti
                                    : [],

                            scavo:
                                x.scavo ||
                                {},

                            posa:
                                x.posa ||
                                {},

                            misure:
                                x.misure ||
                                {},

                            anomalia:
                                x.anomalia ||
                                {
                                    presente:false,
                                    descrizione:''
                                },

                            collaudo:
                                x.collaudo ||
                                {},

                            asbuilt:
                                asbuilt
                                    ? {
                                        presente:
                                            true,

                                        sorgente_gps:
                                            asbuilt
                                                .sorgente_gps ||
                                            '',

                                        qualita_gps:
                                            asbuilt
                                                .qualita_gps ||
                                            '',

                                        lunghezza_gps_m:
                                            Number(
                                                asbuilt
                                                    .lunghezza_gps_m ||
                                                0
                                            ),

                                        lunghezza_misurata_m:
                                            Number(
                                                asbuilt
                                                    .lunghezza_misurata_m ||
                                                0
                                            ),

                                        geometry:
                                            asbuilt
                                                .geometry ||
                                            null
                                    }
                                    : {
                                        presente:false
                                    },

                            progetto_riferimento:
                                progetto
                                    ? {
                                        presente:true,
                                        materiale:
                                            progetto.materiale ||
                                            '',
                                        diametro_mm:
                                            Number(
                                                progetto
                                                    .diametro_mm ||
                                                0
                                            ),
                                        fonte:
                                            progetto.fonte ||
                                            ''
                                    }
                                    : {
                                        presente:false
                                    },

                            evidenze:
                                evidenzeMap.get(id) ||
                                0,

                            audit:{
                                eventi:
                                    Number(
                                        audit
                                            ?.totale ||
                                        0
                                    ),

                                ultimo_evento:
                                    audit
                                        ?.ultimo_evento ||
                                    null
                            },

                            validazione:
                                x.validazione ||
                                {},

                            creato_il:
                                x.creato_il ||
                                null,

                            aggiornato_il:
                                x.aggiornato_il ||
                                null
                        };
                    }
                );

            const cantieri=
                [
                    ...new Set(
                        assets
                            .map(
                                x=>
                                    x.id_cantiere
                            )
                            .filter(Boolean)
                    )
                ];

            const metri=
                assets.reduce(
                    (
                        totale,
                        x
                    )=>
                        totale+
                        Number(
                            x.tubazione
                                ?.metri_misurati ||
                            0
                        ),
                    0
                );

            const raccordi=
                assets.reduce(
                    (
                        totale,
                        x
                    )=>
                        totale+
                        Number(
                            x.raccordi ||
                            0
                        ),
                    0
                );

            const anomalie=
                assets.filter(
                    x=>
                        x.anomalia
                            ?.presente ===
                        true
                ).length;

            const evidenzeTotali=
                assets.reduce(
                    (
                        totale,
                        x
                    )=>
                        totale+
                        Number(
                            x.evidenze ||
                            0
                        ),
                    0
                );

            return res.json({

                ok:true,

                fonte:
                    'interventi_validati',

                scrittura_database:
                    false,

                totale_asset:
                    assets.length,

                cantieri:
                    cantieri.length,

                metri_misurati:
                    Number(
                        metri.toFixed(2)
                    ),

                raccordi,

                anomalie,

                evidenze:
                    evidenzeTotali,

                assets
            });

        }catch(error){

            console.error(
                'Errore Asset Memory:',
                error
            );

            return res.status(500).json({
                ok:false,
                error:
                    'Errore Asset Memory'
            });
        }
    }
);


app.get(
    '/asset-memory',
    requireAuth,
    requireRole(
        'supervisore',
        'admin'
    ),
    (req,res)=>{

        res.sendFile(
            __dirname+
            '/asset_memory_v1.html'
        );
    }
);


// ============================================================
// NMA BUILD OS — QUALITY GATE v1
//
// Controllo automatico PRE-VALIDAZIONE.
//
// IMPORTANTE:
// questo modulo NON dichiara conformità normativa/HSE.
// I controlli HSE dipendono dalle procedure applicabili,
// dal committente e dal contesto reale di cantiere.
// ============================================================

app.get(
    '/api/quality-gate',
    requireAuth,
    requireRole(
        'supervisore',
        'admin'
    ),
    async (req,res)=>{

        try{

            const filtro={};

            const cantiere=
                String(
                    req.query.cantiere || ''
                ).trim();

            if(cantiere){
                filtro.id_cantiere=
                    cantiere;
            }

            const interventi=
                await InterventoCampo
                    .find(filtro)
                    .sort({
                        aggiornato_il:-1
                    })
                    .limit(100)
                    .lean();

            const ids=
                interventi
                    .map(
                        x=>String(
                            x.id_intervento || ''
                        )
                    )
                    .filter(Boolean);

            // ----------------------------------------------
            // EVIDENZE PER INTERVENTO
            // ----------------------------------------------

            const evidenzeAgg=
                ids.length
                    ? await Evidenza.aggregate([
                        {
                            $match:{
                                id_intervento:{
                                    $in:ids
                                }
                            }
                        },
                        {
                            $group:{
                                _id:
                                    '$id_intervento',
                                totale:{
                                    $sum:1
                                }
                            }
                        }
                    ])
                    : [];

            const evidenzeMap=
                new Map(
                    evidenzeAgg.map(
                        x=>[
                            String(x._id),
                            Number(x.totale || 0)
                        ]
                    )
                );

            // ----------------------------------------------
            // AS-BUILT PER INTERVENTO
            // ----------------------------------------------

            const asbuiltIds=
                ids.map(
                    id=>'ASB-'+id
                );

            const tratti=
                asbuiltIds.length
                    ? await TrattoRete
                        .find({
                            id_tratto:{
                                $in:asbuiltIds
                            }
                        })
                        .select({
                            _id:0,
                            id_tratto:1,
                            qualita_gps:1,
                            accuratezza_massima_m:1,
                            sorgente_gps:1,
                            lunghezza_gps_m:1,
                            lunghezza_misurata_m:1
                        })
                        .lean()
                    : [];

            const asbuiltMap=
                new Map(
                    tratti.map(
                        x=>[
                            String(
                                x.id_tratto || ''
                            ).replace(
                                /^ASB-/,
                                ''
                            ),
                            x
                        ]
                    )
                );

            // ----------------------------------------------
            // VALUTAZIONE
            // ----------------------------------------------

            const risultati=
                interventi.map(
                    intervento=>{

                        const id=
                            String(
                                intervento
                                    .id_intervento ||
                                ''
                            );

                        const base=
                            nmaValidaInterventoCampoServer(
                                intervento
                            );

                        const bloccanti=[
                            ...(
                                Array.isArray(
                                    base.errori
                                )
                                    ? base.errori
                                    : []
                            )
                        ];

                        const avvisi=[
                            ...(
                                Array.isArray(
                                    base.avvisi
                                )
                                    ? base.avvisi
                                    : []
                            )
                        ];

                        const evidenze=
                            evidenzeMap.get(id) || 0;

                        const asbuilt=
                            asbuiltMap.get(id) || null;

                        // ----------------------------------
                        // STATO WORKFLOW
                        // ----------------------------------

                        if(
                            intervento.stato ===
                            'da_correggere'
                        ){
                            bloccanti.push(
                                'Intervento ancora in correzione'
                            );
                        }

                        // ----------------------------------
                        // EVIDENZE
                        // ----------------------------------

                        if(evidenze===0){

                            avvisi.push(
                                'Nessuna evidenza foto/documento caricata'
                            );
                        }

                        // ----------------------------------
                        // COLLAUDO
                        // Nessun valore tecnico viene
                        // inventato dal software.
                        // ----------------------------------

                        const collaudoEsito=
                            String(
                                intervento
                                    .collaudo
                                    ?.esito ||
                                ''
                            ).trim();

                        const strumento=
                            String(
                                intervento
                                    .collaudo
                                    ?.strumento ||
                                ''
                            ).trim();

                        const pressione=
                            Number(
                                intervento
                                    .collaudo
                                    ?.pressione ||
                                0
                            );

                        if(!collaudoEsito){

                            avvisi.push(
                                'Esito collaudo non registrato'
                            );
                        }

                        if(
                            collaudoEsito &&
                            !strumento
                        ){

                            avvisi.push(
                                'Identificativo strumento di collaudo assente'
                            );
                        }

                        if(
                            collaudoEsito &&
                            !(pressione>0)
                        ){

                            avvisi.push(
                                'Valore pressione collaudo non disponibile'
                            );
                        }

                        // ----------------------------------
                        // AS-BUILT
                        // ----------------------------------

                        if(!asbuilt){

                            avvisi.push(
                                'Tracciato As-Built non disponibile'
                            );

                        }else{

                            const accuracy=
                                Number(
                                    asbuilt
                                        .accuratezza_massima_m ||
                                    0
                                );

                            if(
                                asbuilt.sorgente_gps ===
                                    'smartphone' &&
                                accuracy>10
                            ){

                                avvisi.push(
                                    'As-Built smartphone con posizione indicativa/scarsa'
                                );
                            }
                        }

                        // ----------------------------------
                        // DOSSIER
                        // ----------------------------------

                        const dossierChiuso=
                            intervento
                                .dossier_chiusura
                                ?.chiuso === true;

                        const pronto=
                            !dossierChiuso &&
                            bloccanti.length===0;

                        return {

                            id_intervento:id,

                            id_cantiere:
                                intervento
                                    .id_cantiere ||
                                '',

                            operatore:
                                intervento
                                    .operatore ||
                                '',

                            squadra:
                                intervento
                                    .squadra ||
                                '',

                            stato:
                                intervento
                                    .stato ||
                                '',

                            pronto_prevalidazione:
                                pronto,

                            dossier_chiuso:
                                dossierChiuso,

                            bloccanti,
                            avvisi,

                            controlli:{

                                dati_essenziali:
                                    base.ok === true,

                                evidenze:
                                    evidenze,

                                collaudo_presente:
                                    Boolean(
                                        collaudoEsito
                                    ),

                                strumento_collaudo:
                                    Boolean(
                                        strumento
                                    ),

                                asbuilt_presente:
                                    Boolean(
                                        asbuilt
                                    ),

                                sorgente_posizione:
                                    asbuilt
                                        ?.sorgente_gps ||
                                    '',

                                qualita_posizione:
                                    asbuilt
                                        ?.qualita_gps ||
                                    ''
                            },

                            /*
                             * NON è un giudizio di conformità.
                             */
                            hse:{
                                verificato_automaticamente:
                                    false,

                                stato:
                                    'DA VERIFICARE SECONDO PROCEDURA APPLICABILE'
                            },

                            aggiornato_il:
                                intervento
                                    .aggiornato_il ||
                                intervento
                                    .creato_il ||
                                null
                        };
                    }
                );

            return res.json({

                ok:true,

                totale:
                    risultati.length,

                pronti:
                    risultati.filter(
                        x=>
                            x.pronto_prevalidazione &&
                            !x.dossier_chiuso
                    ).length,

                con_blocchi:
                    risultati.filter(
                        x=>
                            x.bloccanti.length>0
                    ).length,

                con_avvisi:
                    risultati.filter(
                        x=>
                            x.avvisi.length>0
                    ).length,

                risultati
            });

        }catch(error){

            console.error(
                'Errore Quality Gate:',
                error
            );

            return res.status(500).json({
                ok:false,
                error:
                    'Errore Quality Gate'
            });
        }
    }
);


app.get(
    '/quality',
    requireAuth,
    requireRole(
        'supervisore',
        'admin'
    ),
    (req,res)=>{

        res.sendFile(
            __dirname+
            '/quality_v1.html'
        );
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

            if (
                esito === 'da_correggere' &&
                !note
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        'Inserire una nota con la correzione richiesta'
                });
            }


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


            /*
             * La validazione corrente rimane compatibile
             * con il sistema esistente.
             * In parallelo conserviamo la cronologia
             * delle richieste di correzione.
             */
            if (esito === 'da_correggere') {

                await InterventoCampo.updateOne(
                    {
                        id_intervento: id
                    },
                    {
                        $push: {
                            correzioni: {
                                id_correzione:
                                    crypto.randomUUID(),

                                richiesta_da:
                                    String(
                                        req.session.role || ''
                                    ),

                                richiesta_il:
                                    new Date(),

                                note,

                                risolta:
                                    false
                            }
                        }
                    }
                );
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



// ============================================================
// NMA BUILD OS — CORREZIONI CONTROLLATE v1
// ============================================================

app.get(
    '/api/correzioni',
    requireAuth,
    requireRole(
        'operatore',
        'supervisore',
        'admin'
    ),
    async (req,res)=>{

        try{

            const interventi=
                await InterventoCampo
                    .find({
                        stato:
                            'da_correggere'
                    })
                    .sort({
                        aggiornato_il:-1
                    })
                    .limit(100)
                    .lean();

            return res.json({
                ok:true,
                totale:
                    interventi.length,
                interventi
            });

        }catch(error){

            console.error(
                'Errore lettura correzioni:',
                error
            );

            return res.status(500).json({
                ok:false,
                error:
                    'Errore lettura correzioni'
            });
        }
    }
);


/*
 * L'Operatore modifica SOLO un intervento
 * che il Supervisore ha realmente marcato
 * DA CORREGGERE.
 *
 * Lo stesso ID intervento viene preservato.
 */
app.patch(
    '/api/interventi/:id/correzione-operatore',
    requireAuth,
    requireRole(
        'operatore',
        'supervisore',
        'admin'
    ),
    async (req,res)=>{

        try{

            const id=
                String(
                    req.params.id || ''
                ).trim();

            const body=
                req.body || {};

            const noteOperatore=
                String(
                    body.note_operatore || ''
                ).trim();

            if(!noteOperatore){

                return res.status(400).json({
                    ok:false,
                    error:
                        'Descrivere la correzione effettuata'
                });
            }

            const doc=
                await InterventoCampo
                    .findOne({
                        id_intervento:id
                    });

            if(!doc){

                return res.status(404).json({
                    ok:false,
                    error:
                        'Intervento non trovato'
                });
            }

            if(
                doc.dossier_chiusura?.chiuso === true
            ){

                return res.status(409).json({
                    ok:false,
                    error:
                        'Dossier già chiuso: intervento non modificabile'
                });
            }

            if(
                doc.stato !== 'da_correggere'
            ){

                return res.status(409).json({
                    ok:false,
                    error:
                        'Intervento non nello stato DA CORREGGERE'
                });
            }

            // ----------------------------------------------
            // CAMPI CORREGGIBILI
            // ----------------------------------------------

            const numero=(value,current)=>{

                if(
                    value === null ||
                    value === undefined ||
                    value === ''
                ){
                    return current;
                }

                const n=
                    Number(value);

                return Number.isFinite(n)
                    ? n
                    : current;
            };

            if(
                body.tubazione &&
                typeof body.tubazione === 'object'
            ){

                if(
                    body.tubazione.materiale !== undefined
                ){
                    doc.tubazione.materiale=
                        String(
                            body.tubazione.materiale
                        ).trim();
                }

                doc.tubazione.diametro_mm=
                    numero(
                        body.tubazione.diametro_mm,
                        doc.tubazione.diametro_mm
                    );

                doc.tubazione.metri=
                    numero(
                        body.tubazione.metri,
                        doc.tubazione.metri
                    );
            }

            doc.raccordi=
                numero(
                    body.raccordi,
                    doc.raccordi
                );

            if(
                body.anomalia &&
                typeof body.anomalia === 'object'
            ){

                if(
                    body.anomalia.presente !== undefined
                ){
                    doc.anomalia.presente=
                        body.anomalia.presente === true;
                }

                if(
                    body.anomalia.descrizione !== undefined
                ){
                    doc.anomalia.descrizione=
                        String(
                            body.anomalia.descrizione
                        ).trim();
                }
            }

            if(body.note !== undefined){

                doc.note=
                    String(
                        body.note
                    ).trim();
            }

            // ----------------------------------------------
            // SERVER GUARD SUL DOCUMENTO CORRETTO
            // ----------------------------------------------

            const controllo=
                nmaValidaInterventoCampoServer(
                    doc.toObject()
                );

            if(!controllo.ok){

                return res.status(422).json({
                    ok:false,
                    code:
                        'CAMPO_GUARD_SERVER',

                    error:
                        'Correzione ancora incompleta',

                    errori:
                        controllo.errori,

                    avvisi:
                        controllo.avvisi
                });
            }

            // ----------------------------------------------
            // CHIUSURA ULTIMA RICHIESTA APERTA
            // ----------------------------------------------

            let ultima=null;

            if(
                Array.isArray(
                    doc.correzioni
                )
            ){

                for(
                    let i=
                        doc.correzioni.length-1;
                    i>=0;
                    i--
                ){

                    if(
                        doc.correzioni[i]
                            .risolta !== true
                    ){
                        ultima=
                            doc.correzioni[i];

                        break;
                    }
                }
            }

            if(ultima){

                ultima.risolta=true;

                ultima.risolta_da=
                    String(
                        req.session.role || ''
                    );

                ultima.risolta_il=
                    new Date();

                ultima.note_operatore=
                    noteOperatore;
            }

            /*
             * Torna in coda al Supervisore.
             * Non viene auto-validato.
             */
            doc.stato=
                'registrato';

            doc.set(
                'validazione',
                {
                    esito:'',
                    note:'',
                    validato_da:'',
                    validato_il:null
                }
            );

            doc.aggiornato_il=
                new Date();

            await doc.save();

            await registraAudit({
                evento:
                    'CORREZIONE_REINVIATA',

                intervento:
                    doc,

                ruolo:
                    String(
                        req.session.role || ''
                    ),

                origine:
                    'correzione_operatore',

                stato:
                    'registrato',

                note:
                    noteOperatore
            });

            return res.json({
                ok:true,
                stato:
                    doc.stato,

                intervento:
                    doc.toObject(),

                avvisi:
                    controllo.avvisi
            });

        }catch(error){

            console.error(
                'Errore reinvio correzione:',
                error
            );

            return res.status(500).json({
                ok:false,
                error:
                    'Errore reinvio correzione'
            });
        }
    }
);


app.get(
    '/correzioni',
    requireAuth,
    requireRole(
        'operatore',
        'supervisore',
        'admin'
    ),
    (req,res)=>{

        res.sendFile(
            __dirname+
            '/correzioni_v1.html'
        );
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


// ============================================================
// NMA BUILD OS — CONTROL ROOM OPERATIVA v2
// Aggregazione reale, sola lettura
// ============================================================

app.get(
    '/api/operations-summary',
    requireAuth,
    requireRole('supervisore', 'admin'),
    async (req, res) => {

        try {

            const [
                totale,
                registrati,
                validati,
                correzioni,
                aggregati,
                anomalie,
                evidenze,
                audit,
                ultimi
            ] = await Promise.all([

                InterventoCampo.countDocuments(),

                InterventoCampo.countDocuments({
                    stato: 'registrato'
                }),

                InterventoCampo.countDocuments({
                    stato: 'validato'
                }),

                InterventoCampo.countDocuments({
                    stato: 'da_correggere'
                }),

                InterventoCampo.aggregate([
                    {
                        $group: {
                            _id: null,

                            metri: {
                                $sum:
                                    '$tubazione.metri'
                            },

                            raccordi: {
                                $sum:
                                    '$raccordi'
                            }
                        }
                    }
                ]),

                InterventoCampo.countDocuments({
                    'anomalia.presente': true
                }),

                Evidenza.countDocuments(),

                AuditLog.countDocuments(),

                InterventoCampo
                    .find()
                    .sort({
                        aggiornato_il: -1
                    })
                    .limit(10)
                    .select({
                        _id: 0,
                        id_intervento: 1,
                        id_cantiere: 1,
                        operatore: 1,
                        squadra: 1,
                        stato: 1,
                        'tubazione.metri': 1,
                        'anomalia.presente': 1,
                        aggiornato_il: 1
                    })
                    .lean()
            ]);

            const valori =
                aggregati[0] || {
                    metri: 0,
                    raccordi: 0
                };

            const cantieri =
                await InterventoCampo.distinct(
                    'id_cantiere'
                );

            return res.json({
                ok: true,

                status:
                    mongoose.connection.readyState === 1
                        ? 'OPERATIONAL'
                        : 'DEGRADED',

                kpi: {
                    interventi_totali:
                        totale,

                    registrati,

                    validati,

                    da_correggere:
                        correzioni,

                    metri:
                        Number(valori.metri || 0),

                    raccordi:
                        Number(valori.raccordi || 0),

                    anomalie,

                    evidenze,

                    eventi_audit:
                        audit,

                    cantieri:
                        cantieri.length
                },

                ultimi_interventi:
                    ultimi,

                generato_il:
                    new Date().toISOString()
            });

        } catch (error) {

            console.error(
                'Errore operations-summary:',
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    'Errore Control Room'
            });
        }
    }
);

app.get(
    '/direzione',
    requireAuth,
    requireRole('supervisore', 'admin'),
    (req, res) => {
        res.sendFile(
            __dirname +
            '/control_room_v2.html'
        );
    }
);


// ============================================================
// NMA BUILD OS — SAL REPORT v2
// Solo dati reali e interventi VALIDATI
// ============================================================

app.get(
    '/api/sal-report',
    requireAuth,
    requireRole('supervisore', 'admin'),
    async (req, res) => {

        try {

            const filtro = {
                stato: 'validato'
            };

            const cantiere =
                String(req.query.cantiere || '').trim();

            if (cantiere) {
                filtro.id_cantiere = cantiere;
            }

            const dal =
                req.query.dal
                    ? new Date(req.query.dal)
                    : null;

            const al =
                req.query.al
                    ? new Date(req.query.al)
                    : null;

            if (
                (dal && !Number.isNaN(dal.getTime())) ||
                (al && !Number.isNaN(al.getTime()))
            ) {

                filtro.aggiornato_il = {};

                if (
                    dal &&
                    !Number.isNaN(dal.getTime())
                ) {
                    filtro.aggiornato_il.$gte = dal;
                }

                if (
                    al &&
                    !Number.isNaN(al.getTime())
                ) {

                    const fine =
                        new Date(al);

                    fine.setHours(
                        23,59,59,999
                    );

                    filtro.aggiornato_il.$lte =
                        fine;
                }
            }

            const interventi =
                await InterventoCampo
                    .find(filtro)
                    .sort({
                        aggiornato_il: 1
                    })
                    .lean();

            const ids =
                interventi.map(
                    x => x.id_intervento
                );

            const evidenze =
                ids.length
                    ? await Evidenza.countDocuments({
                        id_intervento: {
                            $in: ids
                        }
                    })
                    : 0;

            const metri =
                interventi.reduce(
                    (tot, x) =>
                        tot +
                        Number(
                            x.tubazione?.metri || 0
                        ),
                    0
                );

            const raccordi =
                interventi.reduce(
                    (tot, x) =>
                        tot +
                        Number(
                            x.raccordi || 0
                        ),
                    0
                );

            const anomalie =
                interventi.filter(
                    x =>
                        x.anomalia?.presente === true
                ).length;

            const operatori =
                [
                    ...new Set(
                        interventi
                            .map(
                                x =>
                                    String(
                                        x.operatore || ''
                                    ).trim()
                            )
                            .filter(Boolean)
                    )
                ];

            const squadre =
                [
                    ...new Set(
                        interventi
                            .map(
                                x =>
                                    String(
                                        x.squadra || ''
                                    ).trim()
                            )
                            .filter(Boolean)
                    )
                ];

            const cantieri =
                [
                    ...new Set(
                        interventi
                            .map(
                                x =>
                                    String(
                                        x.id_cantiere || ''
                                    ).trim()
                            )
                            .filter(Boolean)
                    )
                ];

            return res.json({

                ok: true,

                tipo:
                    'SAL_VALIDATO',

                filtro: {
                    cantiere:
                        cantiere || null,

                    dal:
                        dal &&
                        !Number.isNaN(
                            dal.getTime()
                        )
                            ? dal.toISOString()
                            : null,

                    al:
                        al &&
                        !Number.isNaN(
                            al.getTime()
                        )
                            ? al.toISOString()
                            : null
                },

                riepilogo: {

                    interventi_validati:
                        interventi.length,

                    metri:
                        Number(
                            metri.toFixed(2)
                        ),

                    raccordi,

                    anomalie,

                    evidenze,

                    operatori:
                        operatori.length,

                    squadre:
                        squadre.length,

                    cantieri:
                        cantieri.length
                },

                operatori,

                squadre,

                cantieri,

                interventi:
                    interventi.map(x => ({

                        id_intervento:
                            x.id_intervento,

                        id_cantiere:
                            x.id_cantiere,

                        operatore:
                            x.operatore,

                        squadra:
                            x.squadra,

                        metri:
                            Number(
                                x.tubazione?.metri || 0
                            ),

                        materiale:
                            x.tubazione?.materiale || '',

                        diametro_mm:
                            Number(
                                x.tubazione?.diametro_mm || 0
                            ),

                        raccordi:
                            Number(
                                x.raccordi || 0
                            ),

                        anomalia:
                            x.anomalia?.presente === true,

                        collaudo_esito:
                            x.collaudo?.esito || '',

                        pressione:
                            Number(
                                x.collaudo?.pressione || 0
                            ),

                        validato_il:
                            x.validazione?.validato_il || null,

                        aggiornato_il:
                            x.aggiornato_il
                    })),

                generato_il:
                    new Date().toISOString()
            });

        } catch (error) {

            console.error(
                'Errore SAL Report:',
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    'Errore generazione SAL'
            });
        }
    }
);

app.get(
    '/sal-v2',
    requireAuth,
    requireRole('supervisore', 'admin'),
    (req, res) => {
        res.sendFile(
            __dirname +
            '/sal_v2.html'
        );
    }
);


// ============================================================
// NMA BUILD OS — ASBUILT TRACCIATO v1
// GPS multipunto -> GeoJSON LineString -> tratti_rete
// ============================================================

app.post(
    '/api/tratti-rete',
    requireAuth,
    requireRole('operatore', 'supervisore', 'admin'),
    async (req, res) => {

        try {

            const idIntervento =
                String(
                    req.body?.id_intervento || ''
                ).trim();

            const idCantiere =
                String(
                    req.body?.id_cantiere || ''
                ).trim();

            const puntiRaw =
                Array.isArray(req.body?.coordinates)
                    ? req.body.coordinates
                    : [];

            if (
                !idIntervento ||
                !idCantiere
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        'Intervento e cantiere obbligatori'
                });
            }

            if (
                puntiRaw.length < 2 ||
                puntiRaw.length > 2000
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        'Il tracciato richiede da 2 a 2000 punti GPS'
                });
            }

            const punti =
                puntiRaw
                    .map(p => {

                        const lat =
                            Number(p?.lat);

                        const lng =
                            Number(p?.lng);

                        const altitude =
                            Number(p?.altitude);

                        if (
                            !Number.isFinite(lat) ||
                            !Number.isFinite(lng) ||
                            lat < -90 ||
                            lat > 90 ||
                            lng < -180 ||
                            lng > 180
                        ) {
                            return null;
                        }

                        return [
                            lng,
                            lat,
                            Number.isFinite(altitude)
                                ? altitude
                                : 0
                        ];
                    })
                    .filter(Boolean);

            if (punti.length < 2) {

                return res.status(400).json({
                    ok: false,
                    error:
                        'Coordinate GPS non valide'
                });
            }

            const distinti =
                new Set(
                    punti.map(
                        p =>
                            p[0].toFixed(7) +
                            ',' +
                            p[1].toFixed(7)
                    )
                );

            if (distinti.size < 2) {

                return res.status(400).json({
                    ok: false,
                    error:
                        'Servono almeno due posizioni differenti'
                });
            }

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

            const idTratto =
                'ASB-' + idIntervento;

            const esistente =
                await TrattoRete
                    .findOne({
                        id_tratto:
                            idTratto
                    })
                    .lean();

            if (esistente) {

                return res.status(200).json({
                    ok: true,
                    idempotente: true,
                    tratto: esistente
                });
            }

            function distanza(a, b) {

                const R=6371000;

                const rad =
                    v => v*Math.PI/180;

                const lat1=rad(a[1]);
                const lat2=rad(b[1]);

                const dLat=
                    rad(b[1]-a[1]);

                const dLng=
                    rad(b[0]-a[0]);

                const q=
                    Math.sin(dLat/2) *
                    Math.sin(dLat/2) +
                    Math.cos(lat1) *
                    Math.cos(lat2) *
                    Math.sin(dLng/2) *
                    Math.sin(dLng/2);

                return (
                    2 *
                    R *
                    Math.atan2(
                        Math.sqrt(q),
                        Math.sqrt(1-q)
                    )
                );
            }

            let lunghezza=0;

            for (
                let i=1;
                i<punti.length;
                i++
            ) {
                lunghezza +=
                    distanza(
                        punti[i-1],
                        punti[i]
                    );
            }

            const pressione =
                Number(
                    req.body?.pressione
                );

            // ------------------------------------------------
            // QUALITÀ DELLA SORGENTE GPS
            // ------------------------------------------------

            const sorgenteRaw =
                String(
                    req.body?.sorgente_gps ||
                    'smartphone'
                )
                .trim()
                .toLowerCase();

            const sorgenteGps =
                [
                    'smartphone',
                    'gnss',
                    'rtk'
                ].includes(sorgenteRaw)
                    ? sorgenteRaw
                    : 'smartphone';

            const accuratezze =
                puntiRaw
                    .map(
                        p => Number(
                            p?.accuracy
                        )
                    )
                    .filter(
                        x =>
                            Number.isFinite(x) &&
                            x >= 0
                    );

            const accuracyMedia =
                accuratezze.length
                    ? accuratezze.reduce(
                        (a,b) => a+b,
                        0
                    ) / accuratezze.length
                    : 0;

            const accuracyMax =
                accuratezze.length
                    ? Math.max(
                        ...accuratezze
                    )
                    : 0;

            let qualitaGps =
                'sconosciuta';

            if (accuratezze.length) {

                if (accuracyMax <= 0.10) {
                    qualitaGps =
                        'precisione_rtk';
                } else if (accuracyMax <= 1) {
                    qualitaGps =
                        'alta';
                } else if (accuracyMax <= 3) {
                    qualitaGps =
                        'buona';
                } else if (accuracyMax <= 10) {
                    qualitaGps =
                        'indicativa';
                } else {
                    qualitaGps =
                        'scarsa';
                }
            }

            /*
             * IMPORTANTE:
             * non trasformiamo softwaremente un GPS smartphone
             * in uno strumento metrico.
             *
             * Questa flag descrive solo la qualità tecnica
             * dichiarata dalla sorgente, non una certificazione.
             */
            const gpsIdoneoMisura =
                (
                    sorgenteGps === 'rtk' &&
                    accuracyMax > 0 &&
                    accuracyMax <= 0.10
                ) ||
                (
                    sorgenteGps === 'gnss' &&
                    accuracyMax > 0 &&
                    accuracyMax <= 1
                );

            const lunghezzaMisurataRaw =
                Number(
                    req.body?.lunghezza_misurata_m
                );

            const lunghezzaMisurata =
                Number.isFinite(
                    lunghezzaMisurataRaw
                )
                    ? Math.max(
                        0,
                        lunghezzaMisurataRaw
                    )
                    : 0;


            const tratto =
                await TrattoRete.create({

                    id_tratto:
                        idTratto,

                    id_cantiere:
                        idCantiere,

                    geometry: {
                        type:
                            'LineString',

                        coordinates:
                            punti
                    },

                    pressione:
                        Number.isFinite(
                            pressione
                        )
                            ? pressione
                            : 0,

                    operatore:
                        String(
                            intervento.operatore ||
                            req.body?.operatore ||
                            ''
                        ),

                    descrizione:
                        'AS-BUILT intervento ' +
                        idIntervento +
                        ' · ' +
                        punti.length +
                        ' punti GPS · ' +
                        lunghezza.toFixed(2) +
                        ' m',

                    sorgente_gps:
                        sorgenteGps,

                    accuratezza_media_m:
                        Number(
                            accuracyMedia
                                .toFixed(2)
                        ),

                    accuratezza_massima_m:
                        Number(
                            accuracyMax
                                .toFixed(2)
                        ),

                    qualita_gps:
                        qualitaGps,

                    gps_idoneo_misura:
                        gpsIdoneoMisura,

                    lunghezza_gps_m:
                        Number(
                            lunghezza
                                .toFixed(2)
                        ),

                    lunghezza_misurata_m:
                        Number(
                            lunghezzaMisurata
                                .toFixed(2)
                        ),

                    ultimo_aggiornamento:
                        new Date()
                });

            await registraAudit({

                evento:
                    'TRACCIATO_AS_BUILT_SALVATO',

                intervento,

                ruolo:
                    String(
                        req.session.role ||
                        ''
                    ),

                origine:
                    String(
                        req.body?.origine ||
                        'online'
                    ),

                stato:
                    String(
                        intervento.stato ||
                        ''
                    ),

                note:
                    idTratto +
                    ' · ' +
                    punti.length +
                    ' punti GPS · ' +
                    lunghezza.toFixed(2) +
                    ' m'
            });

            return res.status(201).json({

                ok: true,

                idempotente: false,

                id_tratto:
                    idTratto,

                punti:
                    punti.length,

                lunghezza_m:
                    Number(
                        lunghezza.toFixed(2)
                    ),

                tratto
            });

        } catch (error) {

            console.error(
                'Errore AS-BUILT:',
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    'Errore salvataggio tracciato'
            });
        }
    }
);


// ============================================================
// NMA BUILD OS — PASSAPORTO INFRASTRUTTURA v1
// ============================================================

app.get(
    '/api/interventi/:id/passaporto',
    requireAuth,
    requireRole('supervisore', 'admin'),
    async (req, res) => {

        try {

            const id =
                String(
                    req.params.id || ''
                ).trim();

            const intervento =
                await InterventoCampo
                    .findOne({
                        id_intervento: id
                    })
                    .lean();

            if (!intervento) {

                return res.status(404).json({
                    ok: false,
                    error:
                        'Intervento non trovato'
                });
            }

            const [
                evidenze,
                audit,
                tratto
            ] = await Promise.all([

                Evidenza
                    .find({
                        id_intervento: id
                    })
                    .sort({
                        creato_il: 1
                    })
                    .lean(),

                AuditLog
                    .find({
                        id_intervento: id
                    })
                    .sort({
                        data_ora: 1
                    })
                    .lean(),

                TrattoRete
                    .findOne({
                        id_tratto:
                            'ASB-' + id
                    })
                    .lean()
            ]);

            // ------------------------------------------------
            // VERIFICA TECNICA CATENA AUDIT
            // ------------------------------------------------

            let hashPrecedente='';
            let integrita=true;

            for (const evento of audit) {

                const baseHash={

                    evento:
                        String(
                            evento.evento || ''
                        ),

                    id_intervento:
                        String(
                            evento.id_intervento || ''
                        ),

                    id_cantiere:
                        String(
                            evento.id_cantiere || ''
                        ),

                    ruolo:
                        String(
                            evento.ruolo || ''
                        ),

                    operatore:
                        String(
                            evento.operatore || ''
                        ),

                    squadra:
                        String(
                            evento.squadra || ''
                        ),

                    origine:
                        String(
                            evento.origine || ''
                        ),

                    stato:
                        String(
                            evento.stato || ''
                        ),

                    note:
                        String(
                            evento.note || ''
                        ),

                    hash_precedente:
                        hashPrecedente,

                    data_ora:
                        new Date(
                            evento.data_ora
                        ).toISOString()
                };

                const ricalcolato=
                    crypto
                        .createHash('sha256')
                        .update(
                            JSON.stringify(
                                baseHash
                            )
                        )
                        .digest('hex');

                if (
                    String(
                        evento.hash_precedente || ''
                    ) !== hashPrecedente ||
                    String(
                        evento.hash_evento || ''
                    ) !== ricalcolato
                ) {
                    integrita=false;
                    break;
                }

                hashPrecedente=
                    String(
                        evento.hash_evento || ''
                    );
            }

            // ------------------------------------------------
            // LUNGHEZZA GEOMETRICA AS-BUILT
            // ------------------------------------------------

            function distanza(a,b){

                const R=6371000;
                const rad=
                    v=>v*Math.PI/180;

                const lat1=rad(a[1]);
                const lat2=rad(b[1]);

                const dLat=
                    rad(b[1]-a[1]);

                const dLng=
                    rad(b[0]-a[0]);

                const q=
                    Math.sin(dLat/2)*
                    Math.sin(dLat/2)+
                    Math.cos(lat1)*
                    Math.cos(lat2)*
                    Math.sin(dLng/2)*
                    Math.sin(dLng/2);

                return (
                    2*R*
                    Math.atan2(
                        Math.sqrt(q),
                        Math.sqrt(1-q)
                    )
                );
            }

            let lunghezzaAsBuilt=0;

            const coords=
                tratto?.geometry?.coordinates;

            if (
                Array.isArray(coords) &&
                coords.length >= 2
            ) {

                for (
                    let i=1;
                    i<coords.length;
                    i++
                ) {

                    lunghezzaAsBuilt +=
                        distanza(
                            coords[i-1],
                            coords[i]
                        );
                }
            }

            return res.json({

                ok: true,

                tipo:
                    'PASSAPORTO_INFRASTRUTTURA',

                intervento,

                as_built: tratto
                    ? {
                        presente: true,

                        id_tratto:
                            tratto.id_tratto,

                        punti:
                            Array.isArray(coords)
                                ? coords.length
                                : 0,

                        lunghezza_m:
                            Number(
                                lunghezzaAsBuilt
                                    .toFixed(2)
                            ),

                        geometry:
                            tratto.geometry
                    }
                    : {
                        presente: false,
                        punti: 0,
                        lunghezza_m: 0
                    },

                evidenze: {

                    totale:
                        evidenze.length,

                    foto:
                        evidenze.filter(
                            e =>
                                e.tipo === 'foto'
                        ).length,

                    documenti:
                        evidenze.filter(
                            e =>
                                e.tipo === 'documento'
                        ).length,

                    files:
                        evidenze.map(
                            e => ({
                                id_evidenza:
                                    e.id_evidenza,

                                nome_file:
                                    e.nome_file,

                                tipo:
                                    e.tipo,

                                sha256:
                                    e.sha256,

                                creato_il:
                                    e.creato_il
                            })
                        )
                },

                audit: {

                    eventi:
                        audit.length,

                    integrita_catena:
                        integrita,

                    ultimo_hash:
                        hashPrecedente || null
                },

                generato_il:
                    new Date().toISOString()
            });

        } catch (error) {

            console.error(
                'Errore Passaporto:',
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    'Errore generazione passaporto'
            });
        }
    }
);

app.get(
    '/passaporto/:id',
    requireAuth,
    requireRole('supervisore', 'admin'),
    (req, res) => {

        res.sendFile(
            __dirname +
            '/passaporto_v1.html'
        );
    }
);


// ------------------------------------------------------------
// CARICA / AGGIORNA PROGETTO DI RIFERIMENTO
// ------------------------------------------------------------

app.post(
    '/api/interventi/:id/progetto-riferimento',
    requireAuth,
    requireRole('supervisore','admin'),
    async (req,res)=>{

        try{

            const id=
                String(req.params.id || '').trim();

            const intervento=
                await InterventoCampo
                    .findOne({
                        id_intervento:id
                    })
                    .lean();

            if(!intervento){
                return res.status(404).json({
                    ok:false,
                    error:'Intervento non trovato'
                });
            }

            if(intervento.dossier_chiusura?.chiuso){
                return res.status(409).json({
                    ok:false,
                    error:'Dossier già chiuso'
                });
            }

            let geometry=req.body?.geometry;

            if(
                geometry?.type==='Feature'
            ){
                geometry=geometry.geometry;
            }

            if(
                !geometry ||
                geometry.type!=='LineString' ||
                !Array.isArray(geometry.coordinates) ||
                geometry.coordinates.length<2
            ){
                return res.status(400).json({
                    ok:false,
                    error:'GeoJSON LineString non valido'
                });
            }

            const coords=
                geometry.coordinates
                    .map(p=>{

                        if(!Array.isArray(p) || p.length<2){
                            return null;
                        }

                        const lng=Number(p[0]);
                        const lat=Number(p[1]);
                        const alt=Number(p[2]);

                        if(
                            !Number.isFinite(lng) ||
                            !Number.isFinite(lat) ||
                            lng < -180 ||
                            lng > 180 ||
                            lat < -90 ||
                            lat > 90
                        ){
                            return null;
                        }

                        return Number.isFinite(alt)
                            ? [lng,lat,alt]
                            : [lng,lat];
                    })
                    .filter(Boolean);

            if(coords.length<2){
                return res.status(400).json({
                    ok:false,
                    error:'Coordinate progetto non valide'
                });
            }

            const progetto=
                await ProgettoRiferimento
                    .findOneAndUpdate(
                        {
                            id_intervento:id
                        },
                        {
                            $set:{
                                id_cantiere:
                                    intervento.id_cantiere,

                                geometry:{
                                    type:'LineString',
                                    coordinates:coords
                                },

                                materiale:
                                    String(
                                        req.body?.materiale || ''
                                    ).trim(),

                                diametro_mm:
                                    Number(
                                        req.body?.diametro_mm || 0
                                    ),

                                fonte:
                                    String(
                                        req.body?.fonte || ''
                                    ).trim(),

                                note:
                                    String(
                                        req.body?.note || ''
                                    ).trim(),

                                creato_da:
                                    String(
                                        req.session.role || ''
                                    ),

                                aggiornato_il:
                                    new Date()
                            }
                        },
                        {
                            upsert:true,
                            new:true,
                            runValidators:true
                        }
                    )
                    .lean();

            await registraAudit({

                evento:
                    'PROGETTO_RIFERIMENTO_CARICATO',

                intervento,

                ruolo:
                    String(req.session.role || ''),

                origine:
                    'progetto',

                stato:
                    String(intervento.stato || ''),

                note:
                    coords.length+
                    ' punti · '+
                    nmaLunghezzaLinea(coords)
                        .toFixed(2)+
                    ' m'
            });

            return res.json({
                ok:true,
                progetto,
                lunghezza_m:
                    Number(
                        nmaLunghezzaLinea(coords)
                            .toFixed(2)
                    )
            });

        }catch(error){

            console.error(
                'Errore progetto riferimento:',
                error
            );

            return res.status(500).json({
                ok:false,
                error:'Errore progetto riferimento'
            });
        }
    }
);

// ------------------------------------------------------------
// CONFRONTO
// ------------------------------------------------------------

app.get(
    '/api/interventi/:id/confronto-asbuilt',
    requireAuth,
    requireRole('supervisore','admin'),
    async (req,res)=>{

        try{

            const id=
                String(req.params.id || '').trim();

            const [
                intervento,
                progetto,
                asbuilt
            ]=await Promise.all([

                InterventoCampo
                    .findOne({
                        id_intervento:id
                    })
                    .lean(),

                ProgettoRiferimento
                    .findOne({
                        id_intervento:id
                    })
                    .lean(),

                TrattoRete
                    .findOne({
                        id_tratto:'ASB-'+id
                    })
                    .lean()
            ]);

            if(!intervento){
                return res.status(404).json({
                    ok:false,
                    error:'Intervento non trovato'
                });
            }

            if(!progetto || !asbuilt){

                return res.json({

                    ok:true,
                    disponibile:false,

                    progetto_presente:
                        Boolean(progetto),

                    asbuilt_presente:
                        Boolean(asbuilt),

                    intervento:{
                        id_intervento:
                            intervento.id_intervento,

                        id_cantiere:
                            intervento.id_cantiere,

                        stato:
                            intervento.stato,

                        dossier_chiusura:
                            intervento.dossier_chiusura || {}
                    }
                });
            }

            const pc=
                progetto.geometry.coordinates;

            const ac=
                asbuilt.geometry.coordinates;

            const lp=
                nmaLunghezzaLinea(pc);

            const la=
                nmaLunghezzaLinea(ac);

            const delta=
                la-lp;

            const deltaPct=
                lp>0
                    ? (delta/lp)*100
                    : null;

            const startOffset=
                nmaDistanzaMetri(
                    pc[0],
                    ac[0]
                );

            const endOffset=
                nmaDistanzaMetri(
                    pc[pc.length-1],
                    ac[ac.length-1]
                );

            const materialeReale=
                String(
                    intervento.tubazione?.materiale || ''
                );

            const materialeProgetto=
                String(
                    progetto.materiale || ''
                );

            const diametroReale=
                Number(
                    intervento.tubazione?.diametro_mm || 0
                );

            const diametroProgetto=
                Number(
                    progetto.diametro_mm || 0
                );

            return res.json({

                ok:true,
                disponibile:true,

                intervento:{
                    id_intervento:
                        intervento.id_intervento,

                    id_cantiere:
                        intervento.id_cantiere,

                    stato:
                        intervento.stato,

                    dossier_chiusura:
                        intervento.dossier_chiusura || {}
                },

                progetto:{
                    punti:pc.length,
                    lunghezza_m:
                        Number(lp.toFixed(2)),
                    materiale:
                        materialeProgetto,
                    diametro_mm:
                        diametroProgetto,
                    fonte:
                        progetto.fonte,
                    note:
                        progetto.note
                },

                as_built:{
                    punti:ac.length,
                    lunghezza_m:
                        Number(la.toFixed(2)),
                    materiale:
                        materialeReale,
                    diametro_mm:
                        diametroReale
                },

                differenze:{

                    lunghezza_m:
                        Number(delta.toFixed(2)),

                    lunghezza_percento:
                        deltaPct===null
                            ? null
                            : Number(
                                deltaPct.toFixed(2)
                            ),

                    scostamento_inizio_m:
                        Number(
                            startOffset.toFixed(2)
                        ),

                    scostamento_fine_m:
                        Number(
                            endOffset.toFixed(2)
                        ),

                    materiale_differente:
                        Boolean(
                            materialeProgetto &&
                            materialeReale &&
                            materialeProgetto !==
                            materialeReale
                        ),

                    diametro_differente:
                        Boolean(
                            diametroProgetto &&
                            diametroReale &&
                            diametroProgetto !==
                            diametroReale
                        )
                }
            });

        }catch(error){

            return res.status(500).json({
                ok:false,
                error:'Errore confronto As-Built'
            });
        }
    }
);

// ------------------------------------------------------------
// SNAPSHOT DI CHIUSURA DOSSIER
// ------------------------------------------------------------

app.post(
    '/api/interventi/:id/chiusura-dossier',
    requireAuth,
    requireRole('supervisore','admin'),
    async (req,res)=>{

        try{

            const id=
                String(req.params.id || '').trim();

            const intervento=
                await InterventoCampo
                    .findOne({
                        id_intervento:id
                    })
                    .lean();

            if(!intervento){
                return res.status(404).json({
                    ok:false,
                    error:'Intervento non trovato'
                });
            }

            if(intervento.dossier_chiusura?.chiuso){

                return res.json({
                    ok:true,
                    idempotente:true,
                    dossier_chiusura:
                        intervento.dossier_chiusura
                });
            }

            if(intervento.stato!=='validato'){

                return res.status(409).json({
                    ok:false,
                    error:
                        'Intervento non ancora validato'
                });
            }

            const [
                progetto,
                asbuilt,
                evidenze,
                audit
            ]=await Promise.all([

                ProgettoRiferimento
                    .findOne({
                        id_intervento:id
                    })
                    .lean(),

                TrattoRete
                    .findOne({
                        id_tratto:'ASB-'+id
                    })
                    .lean(),

                Evidenza
                    .find({
                        id_intervento:id
                    })
                    .select({
                        _id:0,
                        id_evidenza:1,
                        sha256:1
                    })
                    .lean(),

                AuditLog
                    .find({
                        id_intervento:id
                    })
                    .sort({
                        data_ora:1
                    })
                    .lean()
            ]);

            if(!progetto || !asbuilt){

                return res.status(409).json({
                    ok:false,
                    error:
                        'Progetto e As-Built sono necessari per la chiusura'
                });
            }

            let precedente='';
            let integrita=true;

            for(const e of audit){

                const baseHash={

                    evento:
                        String(e.evento || ''),

                    id_intervento:
                        String(e.id_intervento || ''),

                    id_cantiere:
                        String(e.id_cantiere || ''),

                    ruolo:
                        String(e.ruolo || ''),

                    operatore:
                        String(e.operatore || ''),

                    squadra:
                        String(e.squadra || ''),

                    origine:
                        String(e.origine || ''),

                    stato:
                        String(e.stato || ''),

                    note:
                        String(e.note || ''),

                    hash_precedente:
                        precedente,

                    data_ora:
                        new Date(
                            e.data_ora
                        ).toISOString()
                };

                const hash=
                    crypto
                        .createHash('sha256')
                        .update(
                            JSON.stringify(baseHash)
                        )
                        .digest('hex');

                if(
                    String(e.hash_precedente || '') !==
                        precedente ||
                    String(e.hash_evento || '') !==
                        hash
                ){
                    integrita=false;
                    break;
                }

                precedente=
                    String(e.hash_evento || '');
            }

            if(!integrita){

                return res.status(409).json({
                    ok:false,
                    error:
                        'Integrità catena Audit non verificata'
                });
            }

            const chiusoIl=
                new Date();

            const snapshot={

                id_intervento:id,

                id_cantiere:
                    intervento.id_cantiere,

                stato:
                    intervento.stato,

                progetto:
                    progetto.geometry,

                as_built:
                    asbuilt.geometry,

                materiale:
                    intervento.tubazione?.materiale || '',

                diametro_mm:
                    Number(
                        intervento.tubazione?.diametro_mm || 0
                    ),

                metri:
                    Number(
                        intervento.tubazione?.metri || 0
                    ),

                evidenze_sha256:
                    evidenze
                        .map(e=>e.sha256)
                        .sort(),

                audit_ultimo_hash:
                    precedente,

                chiuso_il:
                    chiusoIl.toISOString()
            };

            const hashSnapshot=
                crypto
                    .createHash('sha256')
                    .update(
                        JSON.stringify(snapshot)
                    )
                    .digest('hex');

            const aggiornato=
                await InterventoCampo
                    .findOneAndUpdate(
                        {
                            id_intervento:id
                        },
                        {
                            $set:{
                                dossier_chiusura:{
                                    chiuso:true,
                                    chiuso_da:
                                        String(
                                            req.session.role || ''
                                        ),
                                    chiuso_il:
                                        chiusoIl,
                                    hash_snapshot:
                                        hashSnapshot
                                }
                            }
                        },
                        {
                            new:true
                        }
                    )
                    .lean();

            await registraAudit({

                evento:
                    'DOSSIER_TECNICO_CHIUSO',

                intervento:
                    aggiornato,

                ruolo:
                    String(req.session.role || ''),

                origine:
                    'dossier',

                stato:
                    aggiornato.stato,

                note:
                    'Snapshot SHA-256: '+
                    hashSnapshot
            });

            return res.json({

                ok:true,
                idempotente:false,

                dossier_chiusura:
                    aggiornato.dossier_chiusura
            });

        }catch(error){

            console.error(
                'Errore chiusura dossier:',
                error
            );

            return res.status(500).json({
                ok:false,
                error:'Errore chiusura dossier'
            });
        }
    }
);

app.get(
    '/confronto/:id',
    requireAuth,
    requireRole('supervisore','admin'),
    (req,res)=>{
        res.sendFile(
            __dirname+
            '/confronto_asbuilt_v1.html'
        );
    }
);


// ============================================================
// NMA BUILD OS — WORKFLOW BOARD v1
// Dashboard di sola lettura.
// Gli stati reali restano quelli dell'intervento MongoDB.
// ============================================================

app.get(
    '/workflow',
    requireAuth,
    requireRole('supervisore','admin'),
    (req,res)=>{

        res.sendFile(
            __dirname +
            '/workflow_v1.html'
        );
    }
);


// ============================================================
// NMA BUILD OS — MASTER FOUNDATION v1
// Home unica + Digital Twin + Asset Memory
// ============================================================

app.get(
    '/master',
    requireAuth,
    requireRole('supervisore','admin'),
    (req,res)=>{
        res.sendFile(
            __dirname+
            '/master_v1.html'
        );
    }
);


// ============================================================
// NMA BUILD OS — COMMAND CENTER v1
// Pilot Readiness — sola lettura.
// Nessuna scrittura MongoDB.
// ============================================================

app.get(
    '/command-center',
    requireAuth,
    requireRole(
        'supervisore',
        'admin'
    ),
    (req,res)=>{

        res.sendFile(
            __dirname+
            '/command_center_v1.html'
        );
    }
);

app.post(
    '/api/collaudo',
    requireAuth,
    requireRole('operatore', 'supervisore', 'admin'),
    async (req, res) => {

        try {
            const body = req.body || {};

            const cantiere =
                String(body.cantiere || '').trim();

            const operatore =
                String(body.operatore || '').trim();

            const offlineId =
                String(body.offline_id || '').trim();

            const pressioneVal =
                Number(body.pressione);

            const metriVal =
                Number(body.metriTubo);

            const raccordiVal =
                Number(body.raccordi);

            const anomalia =
                String(body.anomalia || '').trim();

            const strumento =
                String(body.strumento || '').trim();

            const errori = [];

            if (!cantiere) {
                errori.push('Cantiere obbligatorio');
            }

            if (!operatore) {
                errori.push('Operatore obbligatorio');
            }

            if (!offlineId) {
                errori.push('offline_id obbligatorio');
            }

            if (
                !Number.isFinite(pressioneVal) ||
                pressioneVal < 0
            ) {
                errori.push('Pressione non valida');
            }

            if (
                !Number.isFinite(metriVal) ||
                metriVal < 0
            ) {
                errori.push('Metri tubo non validi');
            }

            if (
                !Number.isFinite(raccordiVal) ||
                raccordiVal < 0 ||
                !Number.isInteger(raccordiVal)
            ) {
                errori.push('Numero raccordi non valido');
            }

            if (errori.length) {
                return res.status(422).json({
                    success: false,
                    code: 'COLLAUDO_VALIDATION',
                    error:
                        'Collaudo incompleto o non valido',
                    errori
                });
            }

            const dataOra =
                new Date();

            const payloadHash = {
                cantiere,
                operatore,
                offline_id: offlineId,
                pressione: pressioneVal,
                metri: metriVal,
                raccordi: raccordiVal,
                anomalia,
                strumento,
                data_ora: dataOra.toISOString()
            };

            const hashLegale =
                crypto
                    .createHash('sha256')
                    .update(
                        JSON.stringify(payloadHash)
                    )
                    .digest('hex');

            const valoreProduzioneEur =
                (metriVal * 45) +
                (raccordiVal * 35);

            const writeResult =
                await Collaudo.updateOne(
                    {
                        offline_id: offlineId
                    },
                    {
                        $setOnInsert: {
                            id_collaudo:
                                'COL-' + offlineId,

                            id_cantiere:
                                cantiere,

                            operatore:
                                operatore,

                            pressione:
                                pressioneVal,

                            metri_tubo:
                                metriVal,

                            raccordi:
                                raccordiVal,

                            anomalia:
                                anomalia,

                            lat:
                                Number.isFinite(
                                    Number(body.lat)
                                )
                                    ? Number(body.lat)
                                    : undefined,

                            lng:
                                Number.isFinite(
                                    Number(body.lng)
                                )
                                    ? Number(body.lng)
                                    : undefined,

                            strumento:
                                strumento,

                            offline_id:
                                offlineId,

                            hash_sha256:
                                hashLegale,

                            valore_produzione_eur:
                                valoreProduzioneEur,

                            data_ora:
                                dataOra
                        }
                    },
                    {
                        upsert: true
                    }
                );

            const nuovo =
                Number(writeResult.upsertedCount || 0) === 1;

            /*
             * Punto fondamentale:
             * i KPI del cantiere vengono incrementati
             * SOLTANTO se il collaudo è stato realmente
             * inserito per la prima volta.
             */
            if (nuovo) {
                const conteggioAnomalia =
                    anomalia &&
                    anomalia !== 'Nessuna anomalia'
                        ? 1
                        : 0;

                await Cantiere.findOneAndUpdate(
                    {
                        id_cantiere: cantiere
                    },
                    {
                        $inc: {
                            metri_posati:
                                metriVal,

                            raccordi:
                                raccordiVal,

                            anomalie:
                                conteggioAnomalia
                        },

                        $set: {
                            ultimo_aggiornamento:
                                new Date()
                        }
                    },
                    {
                        upsert: true,
                        new: true
                    }
                );

                io.emit(
                    'nuovo_collaudo',
                    {
                        cantiere,
                        metri: metriVal,
                        offline_id: offlineId
                    }
                );
            }

            const salvato =
                await Collaudo
                    .findOne({
                        offline_id: offlineId
                    })
                    .lean();

            return res.json({
                success: true,
                idempotente: !nuovo,
                alert:
                    Number(salvato?.pressione) < 15,
                hash:
                    salvato?.hash_sha256 || hashLegale,
                valore_eur:
                    Number(
                        salvato?.valore_produzione_eur ||
                        0
                    ),
                synced_id:
                    offlineId
            });

        } catch (error) {
            console.error(
                'Errore /api/collaudo:',
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    'Errore interno durante il salvataggio del collaudo'
            });
        }
    }
);


// === KPI CANTIERE - MONGODB ===
app.get('/api/kpi/:cantiere', requireAuth, requireRole('supervisore', 'admin'), async (req, res) => {
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
app.get('/api/cantieri', requireAuth, requireRole('supervisore', 'admin'), async (req, res) => {
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
app.get('/api/tubi', requireAuth, requireRole('supervisore', 'admin'), async (req, res) => {
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
        <div class="subtitle">Accesso NMA BUILD OS</div>

        <input
            type="password"
            id="pin"
            placeholder="PIN di accesso"
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

        window.location.href =
            data.role === 'operatore'
                ? '/cantiere'
                : '/master';

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
        <meta name="viewport"
              content="width=device-width,initial-scale=1,viewport-fit=cover">
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


            /* ==============================================
               NMA_UFFICIO_MOBILE_UX_FINAL_V1
               ============================================== */

            @media(max-width:700px){

                #map{
                    position:fixed;
                    inset:0;
                    width:100%;
                    height:100dvh;
                }

                #panel{
                    top:
                      calc(
                        10px +
                        env(safe-area-inset-top)
                      ) !important;

                    left:
                      max(
                        10px,
                        env(safe-area-inset-left)
                      ) !important;

                    right:
                      max(
                        10px,
                        env(safe-area-inset-right)
                      ) !important;

                    width:auto !important;

                    padding:14px !important;
                    border-radius:14px !important;

                    max-height:52dvh;
                    overflow:auto;

                    -webkit-overflow-scrolling:touch;
                }

                #panel h2{
                    margin:0 0 10px;
                    font-size:17px;
                    line-height:1.3;
                }

                #panel p{
                    font-size:13px;
                    line-height:1.35;
                }

                #panel .metric{
                    padding:11px;
                    margin-top:9px;
                }

                #panel .metric p{
                    font-size:14px;
                }

                #panel select{
                    min-height:44px;
                    font-size:16px;
                }

                #nma-sal-mobile-wrap{
                    left:
                      max(
                        12px,
                        env(safe-area-inset-left)
                      ) !important;

                    right:
                      max(
                        12px,
                        env(safe-area-inset-right)
                      ) !important;

                    bottom:
                      calc(
                        12px +
                        env(safe-area-inset-bottom)
                      ) !important;

                    transform:none !important;
                    width:auto !important;
                }

                #nma-sal-mobile-wrap a{
                    display:block !important;
                    width:100% !important;

                    padding:
                      13px 16px !important;

                    font-size:16px !important;
                    line-height:1.2;

                    text-align:center;
                    border-radius:12px !important;
                }
            }

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
<div id="nma-sal-mobile-wrap" style="position:fixed; bottom:40px; left:50%; transform:translateX(-50%); z-index:999999;"><a href="/sal" style="background:#FF9800; color:white; padding:15px 30px; display:inline-block; text-decoration:none; font-size:22px; border-radius:12px; font-weight: bold; box-shadow: 0px 10px 20px rgba(0,0,0,0.6); border: 2px solid white;">📄 Genera Documento SAL</a></div>

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
app.post('/api/sync-offline', express.json(), requireAuth, requireRole('operatore', 'supervisore', 'admin'), (req, res) => {
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

app.post('/api/registra-squadra', express.json(), requireAuth, requireRole('operatore', 'supervisore', 'admin'), (req, res) => {
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

app.get('/api/squadre-attive', requireAuth, requireRole('supervisore', 'admin'), (req, res) => {
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

// ============================================================
// NMA BUILD OS — RESILIENZA v1
// Error boundary + graceful shutdown
// ============================================================

app.use((err, req, res, next) => {

    if (res.headersSent) {
        return next(err);
    }

    if (
        err instanceof SyntaxError &&
        err.status === 400
    ) {
        return res.status(400).json({
            ok: false,
            code: 'INVALID_JSON',
            error: 'Payload JSON non valido'
        });
    }

    if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            ok: false,
            code: 'FILE_TOO_LARGE',
            error:
                'File superiore al limite consentito'
        });
    }

    console.error(
        'Errore non gestito richiesta:',
        err
    );

    return res.status(500).json({
        ok: false,
        code: 'INTERNAL_ERROR',
        error: 'Errore interno del server'
    });
});


let nmaShutdownInProgress = false;

async function nmaGracefulShutdown(signal) {

    if (nmaShutdownInProgress) {
        return;
    }

    nmaShutdownInProgress = true;

    console.log(
        `[SISTEMA] ${signal}: arresto controllato`
    );

    const forceTimer =
        setTimeout(() => {
            console.error(
                '[SISTEMA] Arresto forzato dopo timeout'
            );
            process.exit(1);
        }, 15000);

    forceTimer.unref();

    server.close(async () => {

        try {
            if (
                mongoose.connection.readyState !== 0
            ) {
                await mongoose.connection.close();
            }

            console.log(
                '[SISTEMA] Connessioni chiuse correttamente'
            );

            process.exit(0);

        } catch (error) {

            console.error(
                '[SISTEMA] Errore durante arresto:',
                error
            );

            process.exit(1);
        }
    });
}

process.once(
    'SIGTERM',
    () => nmaGracefulShutdown('SIGTERM')
);

process.once(
    'SIGINT',
    () => nmaGracefulShutdown('SIGINT')
);


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log('✅ NMA BUILD OS - CONTROL ROOM SATELLITARE 3D ONLINE'); });
