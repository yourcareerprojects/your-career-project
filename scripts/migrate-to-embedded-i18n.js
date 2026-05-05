#!/usr/bin/env node
/**
 * One-way migration: copy EN from canonical CareerPath/Skill fields and DE from
 * *translations collections into embedded { en, de } on main documents.
 *
 * Idempotent: never overwrites existing embedded `en`. Fills or preserves `de`
 * per rules in the project spec. Does not delete translation collections.
 */
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/database');
const CareerPath = require('../src/server/models/CareerPath');
const Skill = require('../src/server/models/Skill');
const { normalizeSkillKey, toDisplayLabel } = require('../src/server/services/careerPathSkillService');

const DE = 'de';
const EN = 'en';
const BATCH = 300;

function getTitleEn(pathDoc) {
  const t = pathDoc?.title;
  if (t && typeof t === 'object' && t.en != null) return String(t.en);
  if (typeof t === 'string') return t;
  return '';
}

function getDescriptionEn(pathDoc) {
  const d = pathDoc?.description;
  if (d && typeof d === 'object' && d.en != null) return String(d.en);
  if (typeof d === 'string') return d;
  return '';
}

function readEmbeddedDeField(container) {
  if (!container || typeof container !== 'object') return { hasKey: false, value: undefined };
  if (!Object.prototype.hasOwnProperty.call(container, 'de')) return { hasKey: false, value: undefined };
  return { hasKey: true, value: container.de };
}

/**
 * Picks a German string: existing non-empty embedded > translation table > null.
 * Never copies English into `de`.
 * Non-empty `fromTranslation` wins over a placeholder `de: null` (e.g. from cleanup-legacy-i18n).
 */
function mergeDeutsch(existing, fromTranslation) {
  if (typeof existing === 'string' && existing.trim() !== '') return existing.trim();
  if (existing != null && existing !== '') return existing;
  if (fromTranslation == null) return null;
  const s = String(fromTranslation).trim();
  return s || null;
}

function mergeDeOnContainer(container, fromTranslation) {
  const tr = fromTranslation != null ? String(fromTranslation).trim() : '';
  if (tr) return tr;
  const { hasKey, value } = readEmbeddedDeField(container || {});
  if (hasKey && value === null) return null;
  return mergeDeutsch(value, fromTranslation);
}

async function loadDeCareerPathTranslations() {
  const rows = await mongoose.connection.db
    .collection('careerpathtranslations')
    .find({ language: DE }, { projection: { careerPathId: 1, title: 1, description: 1 } })
    .toArray();
  const map = new Map();
  for (const r of rows) {
    map.set(String(r.careerPathId), { title: r.title, description: r.description || '' });
  }
  return map;
}

async function loadSkillTranslationMaps() {
  const rows = await mongoose.connection.db
    .collection('skilltranslations')
    .find(
      { language: { $in: [EN, DE] } },
      { projection: { skillId: 1, language: 1, label: 1 } }
    )
    .toArray();
  const en = new Map();
  const de = new Map();
  for (const r of rows) {
    const lang = String(r.language || '').toLowerCase().split('-')[0];
    if (lang === EN) en.set(String(r.skillId), r.label);
    if (lang === DE) de.set(String(r.skillId), r.label);
  }
  return { en, de };
}

async function loadSkillDomainDeByKey() {
  const rows = await mongoose.connection.db
    .collection('skilldomaintranslations')
    .find({ language: DE }, { projection: { domainKey: 1, label: 1 } })
    .toArray();
  const m = new Map();
  for (const r of rows) {
    m.set(r.domainKey, r.label);
  }
  return m;
}

function resolveEnLabelForSkill(key, skillId, trEn) {
  const fromTr = trEn.get(skillId);
  if (fromTr && String(fromTr).trim() !== '') return String(fromTr).trim();
  return toDisplayLabel(String(key || '').replace(/_/g, ' '));
}

function nextSkillLabel(doc, trEn, trDe) {
  const id = String(doc._id);
  const k = String(doc.key || '');
  const enExisting = doc.label && typeof doc.label === 'object' && doc.label.en != null
    ? String(doc.label.en).trim()
    : '';
  const en = enExisting || resolveEnLabelForSkill(k, id, trEn);
  const fromTr = trDe.get(id);
  const trDeStr = fromTr != null && String(fromTr).trim() !== '' ? String(fromTr).trim() : null;
  if (trDeStr != null) {
    return { en, de: trDeStr };
  }
  const { hasKey, value: deExisting } = readEmbeddedDeField(doc.label || {});
  let de;
  if (hasKey && deExisting === null) de = null;
  else de = mergeDeutsch(deExisting, null);
  return { en, de: de == null ? null : de };
}

/**
 * Produces the canonical { en, de } for a skillDomains.skill_domains[].domain value.
 * Never overwrites a non-empty embedded `en` on later runs.
 */
function toEmbeddedDomain(domainValue, deByKey) {
  if (domainValue == null) return null;
  if (typeof domainValue === 'string') {
    const en = String(domainValue).trim();
    if (!en) return null;
    const key = normalizeSkillKey(en);
    return { en, de: mergeDeutsch(undefined, deByKey.get(key)) };
  }
  if (typeof domainValue === 'object') {
    const en = String(domainValue.en != null ? domainValue.en : '').trim();
    const key = normalizeSkillKey(domainValue.key || en);
    const fromTr = deByKey.get(key);
    const trDeStr = fromTr != null && String(fromTr).trim() !== '' ? String(fromTr).trim() : null;
    const { hasKey, value: deEx } = readEmbeddedDeField(domainValue);
    let de;
    if (trDeStr != null) {
      de = trDeStr;
    } else if (hasKey && deEx === null) {
      de = null;
    } else {
      de = mergeDeutsch(deEx, deByKey.get(key));
    }
    if (!en) return { en: '', de: de == null ? null : de };
    return { en, de: de == null ? null : de };
  }
  return null;
}

function domainEmbeddedEqual(prev, nextEmb) {
  if (nextEmb == null) return prev == null;
  if (typeof prev === 'string') return false;
  if (prev && typeof prev === 'object') {
    const d0 = readEmbeddedDeField(prev).value;
    return String(prev.en || '') === String(nextEmb.en) && d0 === nextEmb.de;
  }
  return false;
}

async function run() {
  const log = console;
  await connectDB();

  log.log('[migrate-to-embedded-i18n] loading DE rows…');
  const deByCareerPathId = await loadDeCareerPathTranslations();
  const { en: trEn, de: trDe } = await loadSkillTranslationMaps();
  const deDomainByKey = await loadSkillDomainDeByKey();

  let cpScanned = 0;
  let cpUpdated = 0;
  let missingCpTitleDe = 0;
  const sampleMissingTitle = [];
  const bulkCp = [];
  const flushCp = async () => {
    if (bulkCp.length === 0) return;
    const r = await CareerPath.collection.bulkWrite(bulkCp, { ordered: false });
    cpUpdated += (r.modifiedCount || 0) + (r.upsertedCount || 0);
    bulkCp.length = 0;
  };

  const cpCursor = CareerPath.find({}, { title: 1, description: 1, escoId: 1 }).lean().cursor();
  for await (const doc of cpCursor) {
    cpScanned += 1;
    const tr = deByCareerPathId.get(String(doc._id));
    const enTitle = getTitleEn(doc);
    if (!enTitle) {
      log.warn(`[migrate] careerpath ${doc._id} has no English title, skipping`);
      continue;
    }
    const enDesc = getDescriptionEn(doc) || '';
    const titleDe = mergeDeOnContainer(doc.title, tr?.title);
    const descDe = mergeDeOnContainer(doc.description, tr?.description);
    const newTitle = { en: enTitle, de: titleDe == null ? null : titleDe };
    const newDesc = { en: enDesc, de: descDe == null ? null : descDe };
    if (newTitle.de == null && sampleMissingTitle.length < 20) {
      sampleMissingTitle.push(String(doc.escoId || doc._id));
    }
    if (newTitle.de == null) missingCpTitleDe += 1;

    const tSame =
      doc.title
      && typeof doc.title === 'object'
      && String(doc.title.en) === newTitle.en
      && (Object.prototype.hasOwnProperty.call(doc.title, 'de')
        ? doc.title.de === newTitle.de
        : newTitle.de == null);
    const dSame =
      doc.description
      && typeof doc.description === 'object'
      && String((doc.description.en != null) ? doc.description.en : '') === newDesc.en
      && (Object.prototype.hasOwnProperty.call(doc.description, 'de')
        ? doc.description.de === newDesc.de
        : newDesc.de == null);

    if (tSame && dSame) continue;
    if (!tSame && !dSame) {
      bulkCp.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { title: newTitle, description: newDesc } } } });
    } else if (!tSame) {
      bulkCp.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { title: newTitle } } } });
    } else {
      bulkCp.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { description: newDesc } } } });
    }
    if (bulkCp.length >= BATCH) await flushCp();
  }
  await flushCp();
  log.log(
    `[migrate] careerpaths scanned=${cpScanned} writes=${cpUpdated} pathsMissingDeTitle=${missingCpTitleDe} sampleMissing=${JSON.stringify(
      sampleMissingTitle
    )}`
  );

  let skScanned = 0;
  let skUpdated = 0;
  let skMissingDe = 0;
  const sampleKeys = [];
  const bulkSk = [];
  const flushSk = async () => {
    if (bulkSk.length === 0) return;
    const r = await Skill.collection.bulkWrite(bulkSk, { ordered: false });
    skUpdated += (r.modifiedCount || 0) + (r.upsertedCount || 0);
    bulkSk.length = 0;
  };
  const skCur = Skill.find({}).lean().cursor();
  for await (const doc of skCur) {
    skScanned += 1;
    const next = nextSkillLabel(doc, trEn, trDe);
    if (next.de == null) {
      skMissingDe += 1;
      if (sampleKeys.length < 30) sampleKeys.push(doc.key);
    }
    const same = doc.label
      && typeof doc.label === 'object'
      && String(doc.label.en) === String(next.en)
      && (Object.prototype.hasOwnProperty.call(doc.label, 'de') ? doc.label.de === next.de : next.de == null);
    if (same) continue;
    bulkSk.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { label: next } },
      },
    });
    if (bulkSk.length >= BATCH) await flushSk();
  }
  await flushSk();
  log.log(
    `[migrate] skills scanned=${skScanned} writes=${skUpdated} missingDe=${skMissingDe} sampleKeys=${JSON.stringify(sampleKeys)}`
  );

  let domScanned = 0;
  let domUpdated = 0;
  const bulkDom = [];
  const flushDom = async () => {
    if (bulkDom.length === 0) return;
    const r = await CareerPath.collection.bulkWrite(bulkDom, { ordered: false });
    domUpdated += (r.modifiedCount || 0) + (r.upsertedCount || 0);
    bulkDom.length = 0;
  };
  const domCur = CareerPath.find({ 'skillDomains.skill_domains.0': { $exists: true } }, { skillDomains: 1 }).lean().cursor();
  for await (const doc of domCur) {
    domScanned += 1;
    const sds = doc?.skillDomains?.skill_domains;
    if (!Array.isArray(sds) || sds.length === 0) continue;
    const next = sds.map((d) => {
      if (!d) return d;
      const newDomain = toEmbeddedDomain(d.domain, deDomainByKey);
      if (newDomain == null) return d;
      if (domainEmbeddedEqual(d.domain, newDomain)) return d;
      return { ...d, domain: newDomain };
    });
    if (JSON.stringify(sds) === JSON.stringify(next)) continue;
    bulkDom.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { 'skillDomains.skill_domains': next } },
      },
    });
    if (bulkDom.length >= BATCH) await flushDom();
  }
  await flushDom();
  log.log(`[migrate] skill-domain subdocs pathsScanned=${domScanned} documentWrites≈${domUpdated}`);

  log.log('[migrate-to-embedded-i18n] done.');
  await mongoose.connection.close();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate-to-embedded-i18n] failed:', err);
      mongoose.connection
        .close()
        .catch(() => {})
        .then(() => process.exit(1));
    });
}

module.exports = { run, mergeDeutsch, toEmbeddedDomain, mergeDeOnContainer };
