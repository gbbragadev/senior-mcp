#!/usr/bin/env node
/**
 * WriteGer.js — Senior HCM .GER Report Model Writer
 *
 * Serializes JSON report models into .raw binary payloads (Delphi TWriter format).
 * This is the inverse of ParseGer.js.
 *
 * Accepts two JSON formats:
 *   1. "full" — the internal model (as returned by parseReportClass before formatOutput)
 *   2. "simplified" — the formatOutput() JSON (from ParseGer.js CLI output)
 *      Missing fields get sensible defaults.
 *
 * Usage:
 *   node tools/WriteGer.js <input.json> [--output <file.raw>]
 *   node tools/WriteGer.js --stdin < model.json > output.raw
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ─── TValueType enum (must match ParseGer.js exactly) ────────────────────────
const VT = {
  vaNull:       0x00,
  vaList:       0x01,
  vaInt8:       0x02,
  vaInt16:      0x03,
  vaInt32:      0x04,
  vaExtended:   0x05,
  vaString:     0x06,
  vaIdent:      0x07,
  vaFalse:      0x08,
  vaTrue:       0x09,
  vaBinary:     0x0A,
  vaSet:        0x0B,
  vaLString:    0x0C,
  vaNil:        0x0D,
  vaCollection: 0x0E,
  vaSingle:     0x0F,
  vaCurrency:   0x10,
  vaDate:       0x11,
  vaWString:    0x12,
  vaInt64:      0x13,
};

// ─── Default values ───────────────────────────────────────────────────────────
const DEFAULTS = {
  version: 2061,
  systemVarVersion: 1001,
  font: { color: 0x80000008, name: 'Arial', size: 8, height: -11, pitch: 0, styleBits: 0 },
  exportClass: { fileExp: false, htmlPag: false, excel: false, report: false, model: false, word: false },
  frameDef: { penMode: 0, penStyle: 0, penWidth: 1, penColor: 0, top: false, left: false, bottom: false, right: false },
  rule: { propName: '', debug: false, number: 0, position: 0, lines: [] },
  brush: { color: 0x00FFFFFF, style: 0 },
  pen: { color: 0, style: 0, mode: 0, width: 1 },
};

// ─── TWriter: low-level binary writer ─────────────────────────────────────────
class TWriter {
  constructor(initialSize = 65536) {
    this.buf = Buffer.alloc(initialSize);
    this.pos = 0;
    this.version = DEFAULTS.version;
  }

  _ensureCapacity(needed) {
    while (this.pos + needed > this.buf.length) {
      const newBuf = Buffer.alloc(this.buf.length * 2);
      this.buf.copy(newBuf);
      this.buf = newBuf;
    }
  }

  writeRawByte(b) {
    this._ensureCapacity(1);
    this.buf[this.pos++] = b & 0xFF;
  }

  writeRawShort(v) {
    this._ensureCapacity(2);
    this.buf.writeInt16LE(v, this.pos);
    this.pos += 2;
  }

  writeRawInt(v) {
    this._ensureCapacity(4);
    this.buf.writeInt32LE(v, this.pos);
    this.pos += 4;
  }

  writeRawLong(v) {
    this._ensureCapacity(8);
    this.buf.writeBigInt64LE(BigInt(v), this.pos);
    this.pos += 8;
  }

  writeRawFloat(v) {
    this._ensureCapacity(4);
    this.buf.writeFloatLE(v, this.pos);
    this.pos += 4;
  }

  writeRawDouble(v) {
    this._ensureCapacity(8);
    this.buf.writeDoubleLE(v, this.pos);
    this.pos += 8;
  }

  // Tagged integer — chooses smallest encoding
  writeInteger(n) {
    n = Number(n) || 0;
    if (n >= 0 && n <= 255) {
      this.writeRawByte(VT.vaInt8);
      this.writeRawByte(n);
    } else if (n >= -32768 && n <= 32767) {
      this.writeRawByte(VT.vaInt16);
      this.writeRawShort(n);
    } else if (n >= -2147483648 && n <= 2147483647) {
      this.writeRawByte(VT.vaInt32);
      this.writeRawInt(n);
    } else {
      this.writeRawByte(VT.vaInt64);
      this.writeRawLong(n);
    }
  }

  writeBoolean(b) {
    this.writeRawByte(b ? VT.vaTrue : VT.vaFalse);
  }

  writeString(s) {
    s = s || '';
    const bytes = Buffer.from(s, 'latin1');
    if (bytes.length <= 255) {
      this.writeRawByte(VT.vaString);
      this.writeRawByte(bytes.length);
    } else {
      this.writeRawByte(VT.vaLString);
      this.writeRawInt(bytes.length);
    }
    this._ensureCapacity(bytes.length);
    bytes.copy(this.buf, this.pos);
    this.pos += bytes.length;
  }

  // Float as 80-bit Delphi extended
  writeFloat(v) {
    v = Number(v) || 0;
    // For integer values, use integer tags (matches ParseGer readFloat)
    if (Number.isInteger(v) && v >= -128 && v <= 127) {
      this.writeRawByte(VT.vaInt8);
      this._ensureCapacity(1);
      this.buf.writeInt8(v, this.pos);
      this.pos += 1;
      return;
    }
    // Use vaSingle for float values (4 bytes, simpler than extended)
    this.writeRawByte(VT.vaSingle);
    this.writeRawFloat(v);
  }

  // Extended float (80-bit) — for TSConfigPage compatibility
  writeExtended(v) {
    v = Number(v) || 0;
    this.writeRawByte(VT.vaExtended);
    this._ensureCapacity(10);
    // Convert double to 80-bit extended (simplified)
    if (v === 0) {
      this.buf.fill(0, this.pos, this.pos + 10);
    } else {
      const sign = v < 0 ? 1 : 0;
      v = Math.abs(v);
      const exp = Math.floor(Math.log2(v));
      const mantissa = v / Math.pow(2, exp);
      const biasedExp = exp + 16383;
      const intMantissa = BigInt(Math.round(mantissa * Math.pow(2, 63)));
      this.buf.writeBigUInt64LE(intMantissa, this.pos);
      this.buf.writeUInt16LE((sign << 15) | (biasedExp & 0x7FFF), this.pos + 8);
    }
    this.pos += 10;
  }

  writeListBegin() {
    this.writeRawByte(VT.vaList);
  }

  writeListEnd() {
    this.writeRawByte(VT.vaNull);
  }

  // Untagged short string: 1-byte len + data (for DFM readStr)
  writeStr(s) {
    s = s || '';
    const bytes = Buffer.from(s, 'latin1');
    this.writeRawByte(bytes.length);
    this._ensureCapacity(bytes.length);
    bytes.copy(this.buf, this.pos);
    this.pos += bytes.length;
  }

  // Image (picType + optional data)
  writeImage(img) {
    if (!img || img.type === 'none') {
      this.writeInteger(0);
      return;
    }
    const typeMap = { bitmap: 1, jpeg: 2, icon: 3, metafile: 4 };
    this.writeInteger(typeMap[img.type] || 0);
    if (img.data) {
      const data = Buffer.from(img.data, 'base64');
      this.writeInteger(data.length);
      this._ensureCapacity(data.length);
      data.copy(this.buf, this.pos);
      this.pos += data.length;
    } else {
      this.writeInteger(img.size || 0);
      // Write placeholder zeros for image data
      if (img.size > 0) {
        this._ensureCapacity(img.size);
        this.buf.fill(0, this.pos, this.pos + img.size);
        this.pos += img.size;
      }
    }
  }

  getBuffer() {
    return this.buf.subarray(0, this.pos);
  }
}

// ─── TSWriter: Senior-specific composites ─────────────────────────────────────
class TSWriter extends TWriter {
  writeFont(font) {
    font = { ...DEFAULTS.font, ...font };
    this.writeInteger(font.color);
    this.writeString(font.name);
    this.writeInteger(font.size);
    if (this.version >= 1101) {
      this.writeInteger(font.height != null ? font.height : -(font.size * 4 / 3 | 0));
      this.writeInteger(font.pitch != null ? font.pitch : 0);
    }
    // Reconstruct styleBits from flags if needed
    let styleBits = font.styleBits || 0;
    if (font.bold) styleBits |= 1;
    if (font.italic) styleBits |= 2;
    if (font.underline) styleBits |= 4;
    if (font.strikeout) styleBits |= 8;
    this.writeRawByte(styleBits);
  }

  writeBrush(brush) {
    brush = { ...DEFAULTS.brush, ...brush };
    this.writeInteger(brush.color);
    this.writeInteger(brush.style);
  }

  writePen(pen) {
    pen = { ...DEFAULTS.pen, ...pen };
    this.writeInteger(pen.color);
    this.writeInteger(pen.style);
    this.writeInteger(pen.mode);
    this.writeInteger(pen.width);
  }
}

// ─── Component Writers ────────────────────────────────────────────────────────

function writeTFExportClass(w, exp) {
  exp = { ...DEFAULTS.exportClass, ...exp };
  w.writeBoolean(exp.fileExp);
  w.writeBoolean(exp.htmlPag);
  w.writeBoolean(exp.excel);
  w.writeBoolean(exp.report);
  w.writeBoolean(exp.model);
  if (w.version >= 2057) {
    w.writeBoolean(exp.word);
  }
}

function writeTSRule(w, rule) {
  if (!rule || typeof rule === 'string') {
    // Convert source string to rule object
    const source = rule || '';
    rule = {
      ...DEFAULTS.rule,
      lines: source ? source.split('\n') : [],
    };
  }
  rule = { ...DEFAULTS.rule, ...rule };
  w.writeString(rule.propName);
  w.writeBoolean(rule.debug);
  w.writeInteger(rule.number);
  w.writeInteger(rule.position);
  if (w.version > 1030) {
    const lines = rule.lines || (rule.source ? rule.source.split('\n') : []);
    w.writeListBegin();
    for (const line of lines) {
      w.writeString(line);
    }
    w.writeListEnd();
  }
}

function writeTSFrameDef(w, frame) {
  frame = { ...DEFAULTS.frameDef, ...frame };
  w.writeInteger(frame.penMode);
  w.writeInteger(frame.penStyle);
  w.writeInteger(frame.penWidth);
  w.writeInteger(frame.penColor);
  w.writeBoolean(frame.top);
  w.writeBoolean(frame.left);
  w.writeBoolean(frame.bottom);
  w.writeBoolean(frame.right);
}

function writeTSDescricao(w, d) {
  w.writeString(d.name || '');
  w.writeFont(d.font || DEFAULTS.font);
  w.writeInteger(d.color != null ? d.color : 0x80000005);
  w.writeInteger(d.top || 0);
  w.writeInteger(d.left || 0);
  w.writeInteger(d.width || 100);
  w.writeInteger(d.height || 17);
  w.writeString(d.caption || '');
  w.writeBoolean(d.parentFont != null ? d.parentFont : true);
  w.writeBoolean(d.parentColor != null ? d.parentColor : true);
  w.writeInteger(d.alignment || 0);
  w.writeString(d.picture || '');
  w.writeBoolean(d.canPrint != null ? d.canPrint : true);
  w.writeString(d.separator || '');
  w.writeString(d.occurrence || '');
  w.writeBoolean(d.expanded != null ? d.expanded : false);
  w.writeBoolean(d.compressed != null ? d.compressed : false);
  w.writeBoolean(d.underlined != null ? d.underlined : false);
  w.writeBoolean(d.italic != null ? d.italic : false);
  w.writeBoolean(d.boldface != null ? d.boldface : false);
  w.writeInteger(d.number || 0);
  w.writeString(d.fieldList || '');
  if (w.version > 1014) w.writeBoolean(d.autoSize != null ? d.autoSize : false);
  if (w.version > 1015) w.writeBoolean(d.transparent != null ? d.transparent : false);
  if (w.version >= 1100) {
    w.writeInteger(d.leftTab || 0);
    w.writeInteger(d.rightTab || 0);
  }
  if (w.version >= 1100) {
    writeTFExportClass(w, d.export);
  }
  writeTSRule(w, d.onPrint);
  if (w.version >= 2036) w.writeRawByte(d.cascadeCharCase || 0);
}

function writeTSCadastro(w, d) {
  writeTSDescricao(w, d);
  w.writeString(d.table || '');
  w.writeString(d.field || '');
  w.writeString(d.tableFieldCorrelate || '');
  w.writeBoolean(d.nullField || false);
  if (w.version > 1022) w.writeBoolean(d.history || false);
}

function writeTSTotal(w, d) {
  writeTSDescricao(w, d);
  w.writeString(d.fieldName || '');
  w.writeString(d.clearBand || '');
  w.writeRawByte(d.typeTotal || 0);
  w.writeString(d.fieldSpecial || '');
  if (w.version > 1011) w.writeInteger(d.typeVar || 0);
}

function writeTSSistema(w, d) {
  writeTSDescricao(w, d);
  if (w.version > 1007) {
    w.writeString(d.occurrenceSys || '');
    writeTSRule(w, d.onOccurrence);
  }
}

function writeTSFormula(w, d) {
  writeTSDescricao(w, d);
  if (w.version >= 1100) w.writeInteger(d.typeVar || 0);
}

function writeTSEspecial(w, d) {
  writeTSDescricao(w, d);
  w.writeInteger(d.specialKind || 0);
  w.writeInteger(d.totalLevel || 0);
  w.writeInteger(d.breakLevel || 0);
  w.writeString(d.tableField || '');
  w.writeString(d.specialPicture || '');
  w.writeInteger(d.result || 0);
  if (w.version >= 2031) w.writeBoolean(d.printActualLevel || false);
}

function writeTSDesenho(w, d) {
  writeTSDescricao(w, d);
  w.writeInteger(d.shape || 0);
  w.writeBrush(d.brush);
  w.writePen(d.pen);
  if (w.version >= 1100) writeTFExportClass(w, d.export);
  if (w.version >= 2006) w.writeBoolean(d.autoAdjustBottom || false);
}

function writeTSMemoran(w, d) {
  w.writeInteger(d.top || 0);
  w.writeInteger(d.left || 0);
  w.writeInteger(d.width || 100);
  w.writeInteger(d.height || 50);
  w.writeString(d.name || '');
  w.writeInteger(d.color != null ? d.color : 0x80000005);
  w.writeFont(d.font || DEFAULTS.font);
  w.writeInteger(d.maxLength || 0);
  w.writeBoolean(d.canPrint != null ? d.canPrint : true);
  w.writeBoolean(d.wordWrap != null ? d.wordWrap : true);
  if (w.version > 1021) w.writeBoolean(d.autoSize || false);
  if (w.version > 1003) {
    w.writeString(d.table || '');
    w.writeString(d.field || '');
  }
  if (w.version > 1025) {
    w.writeBoolean(d.displayEntrance || false);
    w.writeBoolean(d.displayOrder || false);
  }
  if (w.version >= 1100) {
    writeTFExportClass(w, d.export);
  }
  // Memo text
  if (w.version >= 2058) {
    w.writeString(d.text || (d.lines ? d.lines.join('\n') : ''));
  } else {
    const lines = d.lines || (d.text ? d.text.split('\n') : []);
    w.writeListBegin();
    for (const line of lines) {
      w.writeString(line);
    }
    w.writeListEnd();
  }
  writeTSRule(w, d.onPrint);
  if (w.version > 1114) w.writeBoolean(d.transparent || false);
  // Style flags (version >= 2000)
  if (w.version >= 2000) {
    w.writeBoolean(d.expanded || false);
    w.writeBoolean(d.compressed || false);
    w.writeBoolean(d.underlined || false);
    w.writeBoolean(d.italic || false);
    w.writeBoolean(d.boldface || false);
  }
  if (w.version >= 2023) w.writeInteger(d.justify || 0);
  if (w.version >= 2036) w.writeRawByte(d.cascadeCharCase || 0);
}

function writeTSImagem(w, d) {
  w.writeInteger(d.top || 0);
  w.writeInteger(d.left || 0);
  w.writeInteger(d.width || 100);
  w.writeInteger(d.height || 100);
  w.writeString(d.name || '');
  w.writeBoolean(d.autoSize || false);
  w.writeBoolean(d.center || false);
  w.writeBoolean(d.stretch || false);
  w.writeBoolean(d.canPrint != null ? d.canPrint : true);
  if (w.version > 1002) w.writeString(d.tableField || '');
  if (w.version >= 1100) writeTFExportClass(w, d.export);
  if (w.version > 1016) {
    w.writeListBegin();
    for (const s of (d.connectList || [])) {
      w.writeString(s);
    }
    w.writeListEnd();
  }
  writeTSRule(w, d.onPrint);
  // Image data
  if (w.version > 1001) {
    if (w.version >= 1113) {
      w.writeImage(d.image || { type: 'none' });
    } else {
      w.writeInteger(0); // no bitmap
    }
    if (w.version >= 2022) {
      w.writeImage(d.transparency || { type: 'none' });
    }
  }
  if (w.version >= 2009) w.writeBoolean(d.resizeSection || false);
}

function writeTSCodBarra(w, d) {
  w.writeString(d.name || '');
  w.writeInteger(d.top || 0);
  w.writeInteger(d.left || 0);
  w.writeInteger(d.width || 100);
  w.writeInteger(d.height || 50);
  w.writeInteger(d.color || 0);
  w.writeFont(d.font || DEFAULTS.font);
  w.writeBoolean(d.canPrint != null ? d.canPrint : true);
  w.writeBoolean(d.visible != null ? d.visible : true);
  w.writeBoolean(d.autoSize || false);
  w.writeBoolean(d.autoSizeFont || false);
  w.writeInteger(d.barCodeType || 0);
  w.writeInteger(d.barColor || 0);
  w.writeFloat(d.barWidth || 1.0);
  w.writeBoolean(d.bearerBars || false);
  w.writeBoolean(d.calcCheckDigit || false);
  w.writeString(d.data || '');
  w.writeInteger(d.fontAlignment || 0);
  w.writeInteger(d.orientation || 0);
  w.writeBoolean(d.printHumanReadable || false);
  w.writeFloat(d.wideBarRatio || 2.0);
  w.writeString(d.tableField || '');
  w.writeString(d.fillCharacter || '');
  if (w.version >= 1100) writeTFExportClass(w, d.export);
  writeTSRule(w, d.onPrint);
  if (w.version >= 2007) w.writeBoolean(d.isBMPFormat != null ? d.isBMPFormat : true);
  if (w.version >= 2011) {
    w.writeInteger(d.backgroundColor || 0x00FFFFFF);
    w.writeInteger(d.borderSize || 0);
    w.writeInteger(0); // discarded
    w.writeInteger(0); // discarded
  }
}

function writeTSQRCode(w, d) {
  w.writeString(d.name || '');
  w.writeInteger(d.size || 100);
  w.writeBoolean(d.canPrint != null ? d.canPrint : true);
  w.writeInteger(d.top || 0);
  w.writeInteger(d.left || 0);
  w.writeString(d.data || '');
  w.writeString(d.tableField || '');
  writeTFExportClass(w, d.export);
  w.writeInteger(d.margin || 0);
  writeTSRule(w, d.onPrint);
}

function writeTSGrade(w, d) {
  writeTSDescricao(w, d);
  w.writePen(d.pen || DEFAULTS.pen);
  writeTFExportClass(w, d.gradeExport);
  w.writeInteger(d.lineSize || 0);
  w.writeInteger(d.colSize || 0);
  w.writeInteger(d.qtdLine || 0);
  w.writeInteger(d.qtdCol || 0);
  w.writeBoolean(d.autoSize || false);
  w.writeInteger(d.totalSize || 0);
  w.writeInteger(d.sectionSpace || 0);
  w.writeInteger(0); // discarded
  w.writeInteger(0); // discarded
  w.writeString(''); // discarded
  w.writeString(''); // discarded
  w.writeString(''); // discarded
  w.writeString(''); // discarded
  w.writeBoolean(d.generalSize || false);
  w.writeBoolean(d.breakInLine || false);
  w.writeBoolean(false); // discarded
  w.writeBoolean(false); // discarded
}

// ─── Control dispatcher ───────────────────────────────────────────────────────
function writeControl(w, child) {
  // Determine class name from child._class or child.type
  const className = child._class || child.type || 'TSDescricao';
  w.writeString(className);

  switch (className) {
    case 'TSDescricao':  writeTSDescricao(w, child); break;
    case 'TSCadastro':   writeTSCadastro(w, child); break;
    case 'TSTotal':      writeTSTotal(w, child); break;
    case 'TSSistema':    writeTSSistema(w, child); break;
    case 'TSFormula':    writeTSFormula(w, child); break;
    case 'TSEspecial':   writeTSEspecial(w, child); break;
    case 'TSDesenho':    writeTSDesenho(w, child); break;
    case 'TSMemoran':    writeTSMemoran(w, child); break;
    case 'TSImagem':
    case 'TSBaseImage':
    case 'TSImgVetorial': writeTSImagem(w, child); break;
    case 'TSCodBarra':   writeTSCodBarra(w, child); break;
    case 'TSQRCode':     writeTSQRCode(w, child); break;
    case 'TSGrade':      writeTSGrade(w, child); break;
    case 'TSGrafico':
      // TSGrafico is opaque — cannot serialize
      throw new Error(`Cannot serialize TSGrafico (opaque format)`);
    default:
      throw new Error(`Unknown control class: ${className}`);
  }
}

// ─── TSBand Writer ────────────────────────────────────────────────────────────
function writeTSBand(w, band) {
  w.writeInteger(band.top || 0);
  w.writeInteger(band.left || 0);
  w.writeInteger(band.width || 6000);
  w.writeInteger(band.height || 100);
  w.writeString(band.name || '');
  w.writeString(band.caption || band.name || ''); // caption (usually same as name)
  w.writeInteger(band.color != null ? band.color : 0x80000005);
  w.writeFont(band.font || DEFAULTS.font);
  w.writeInteger(band.tag || 0);
  w.writeRawByte(band.pageJump || 0);
  w.writeString(band.bandBreak || '');
  w.writeBoolean(band.canPrint != null ? band.canPrint : true);
  if (w.version > 1013) w.writeString(band.linkBand || '');
  if (w.version >= 1100) {
    w.writeInteger(band.befPrintHTML || 0);
    w.writeInteger(band.aftPrintHTML || 0);
  }
  if (w.version >= 2036) w.writeRawByte(band.cascadeCharCase || 0);

  // Table list
  w.writeListBegin();
  for (const t of (band.tableList || [])) {
    w.writeString(t);
  }
  w.writeListEnd();

  // Frame
  writeTSFrameDef(w, band.frame);

  // Background picture
  if (w.version > 1017) {
    if (w.version >= 2004) {
      // picType 0 = no background
      w.writeInteger(0);
    } else {
      w.writeInteger(0); // size = 0 (no bitmap)
    }
  }

  // Style flags
  if (w.version > 1018) {
    w.writeBoolean(band.expanded || false);
    w.writeBoolean(band.compressed || false);
    w.writeBoolean(band.underlined || false);
    w.writeBoolean(band.italic || false);
    w.writeBoolean(band.boldface || false);
  }

  // Export class
  if (w.version >= 1100) {
    writeTFExportClass(w, band.export);
  }

  // Rules
  writeTSRule(w, band.onBeforePrint);
  writeTSRule(w, band.onAfterPrint);

  // Child controls
  w.writeListBegin();
  for (const child of (band.children || [])) {
    writeControl(w, child);
  }
  w.writeListEnd();
}

// ─── TSDetail Writer (extends TSBand) ─────────────────────────────────────────
function writeTSDetail(w, band) {
  writeTSBand(w, band);
  w.writeString(band.connectBandName || '');
  w.writeBoolean(band.interpolate || false);
  w.writeInteger(band.order || 0);
  w.writeString(band.baseTable || '');
  // classification + relations stubs (empty lists)
  // Write minimal classification (empty)
  w.writeListBegin();
  w.writeListEnd();
  // relationList (empty)
  w.writeListBegin();
  w.writeListEnd();
  // relationParentList (empty)
  w.writeListBegin();
  w.writeListEnd();
}

// ─── String list writer ───────────────────────────────────────────────────────
function writeStringList(w, list) {
  w.writeListBegin();
  for (const s of (list || [])) {
    w.writeString(s);
  }
  w.writeListEnd();
}

// ─── Break list writer ───────────────────────────────────────────────────────
function writeBreakList(w, breaks) {
  w.writeListBegin();
  for (const brk of (breaks || [])) {
    w.writeString(brk.fieldName || '');
    w.writeString(brk.tableName || '');
    w.writeString(brk.bandName || '');
    w.writeString(brk.footerBandName || '');
    if (w.version > 1009) w.writeBoolean(brk.resetPageOnBreak || false);
    if (w.version >= 2020) w.writeBoolean(brk.printFooterNewPage || false);
  }
  w.writeListEnd();
}

// ─── Entrance component (minimal DFM stub) ──────────────────────────────────
function writeEntranceStub(w) {
  // Write a minimal TPF0 DFM component with empty entrance
  // TPF0 signature
  w.writeRawInt(0x30465054);
  // className
  w.writeStr('TSEntranceList');
  // instanceName
  w.writeStr('sEntrance');
  // No properties (empty propName terminates)
  w.writeRawByte(0); // empty string = end of properties
  // No children
  w.writeRawByte(VT.vaNull); // end of children
}

// ─── PDF Properties writer ───────────────────────────────────────────────────
function writePDFProperties(w, pdf) {
  pdf = pdf || {};
  w.writeString(pdf.title || '');
  w.writeString(pdf.author || '');
  w.writeString(pdf.subject || '');
  w.writeString(pdf.keywords || '');
  w.writeString(pdf.creator || '');
  if (w.version >= 2032) w.writeString(pdf.openPassword || '');
  if (w.version >= 2032) w.writeString(pdf.ownerPassword || '');
  if (w.version >= 2042) w.writeBoolean(pdf.embedFonts || false);
}

// ─── Main: writeReportClass ──────────────────────────────────────────────────
function writeReportClass(w, model) {
  // 1. Sentinel
  w.writeString('INICIO MODELO');

  // 2. Binary version
  w.writeInteger(model.binaryVersion || 2025);

  // 3. System var version
  if (w.version > 1029) {
    w.writeInteger(model.systemVarVersion || 1001);
  }

  // 4. useSQLSenior2
  if (w.version >= 2002) {
    w.writeBoolean(model.useSQLSenior2 || false);
  }

  // 5-9. Caption + geometry
  w.writeString(model.caption || 'Modelo Gerador');
  w.writeInteger(model.top || 125);
  w.writeInteger(model.left || 2);
  w.writeInteger(model.width || 805);
  w.writeInteger(model.height || 559);

  // 10-11. VER_ORIGEM
  if (model.logicalExecVersion != null) {
    // Write as vaIdent 'VER_ORIGEM' + integer
    w.writeRawByte(VT.vaIdent);
    const identBytes = Buffer.from('VER_ORIGEM', 'latin1');
    w.writeRawByte(identBytes.length);
    w._ensureCapacity(identBytes.length);
    identBytes.copy(w.buf, w.pos);
    w.pos += identBytes.length;
    w.writeInteger(model.logicalExecVersion);
  }

  // 12. Font
  w.writeFont(model.font || DEFAULTS.font);

  // 13-15. Pixel metrics
  if (w.version >= 1101) w.writeInteger(model.pixPerInch || 96);
  if (w.version >= 1102) {
    w.writeInteger(model.carWidth || 7);
    w.writeInteger(model.carHeight || 14);
  }

  // 16-19. Layout settings
  w.writeInteger(model.color != null ? model.color : 0x80000005);
  w.writeInteger(model.beginLeftBorder || 0);
  w.writeInteger(model.numberImages || 0);
  w.writeInteger(model.betweenImages || 0);
  if (w.version >= 2019) w.writeBoolean(model.orderLineImages || false);
  w.writeInteger(model.maxReportLines || 66);
  w.writeInteger(model.maxColumns || 0);
  w.writeRawByte(model.layoutDefault || 0);
  w.writeBoolean(model.saveEntrance || false);
  w.writeRawByte(model.orientation || 0);
  w.writeRawByte(model.reportType != null ? model.reportType : 1);
  w.writeBoolean(model.titleBeforeHeader || false);
  w.writeRawByte(model.formatReport || 0);
  w.writeBoolean(model.preparation || false);

  if (w.version > 1000) w.writeBoolean(model.lines18 || false);
  if (w.version > 1012) w.writeBoolean(model.uniqueSQL || false);
  if (w.version > 1019) {
    w.writeInteger(model.pxIncrement || 0);
    w.writeInteger(model.pyIncrement || 0);
  }
  if (w.version > 1026) w.writeBoolean(model.printEmptyReport || false);
  if (w.version > 1027) w.writeBoolean(model.printGroupHeaders || false);

  if (w.version >= 1037 && !(w.version >= 1100 && w.version <= 1103)) {
    w.writeBoolean(model.consistModel || false);
  }
  if (w.version >= 1100) w.writeBoolean(model.saveDefinitions || false);
  if (w.version >= 2025) w.writeBoolean(model.useLanguageSeparators || false);
  if (w.version >= 2030) w.writeBoolean(model.useDuplexMode || false);
  if (w.version >= 1100) w.writeString(model.groupEmbrance || '');
  if (w.version >= 2005) w.writeBoolean(model.beforeBandRules || false);
  if (w.version >= 2014) w.writeBoolean(model.pageFooterEndPage || false);
  if (w.version >= 2047) w.writeBoolean(model.titleFooterEndPage || false);
  if (w.version >= 2036) w.writeRawByte(model.cascadeCharCase || 0);
  if (w.version >= 2039) w.writeRawByte(model.showEntranceReportService || 0);
  if (w.version >= 2046) w.writeBoolean(model.useConfReg || false);

  // Config page
  if (w.version > 1028) {
    w.writeBoolean(false); // hasCfgPage = false (skip config page)
  }

  if (w.version >= 1100) w.writeBoolean(model.insertSpace != null ? model.insertSpace : true);

  // Model description
  const desc = model.description || [];
  w.writeListBegin();
  for (const line of desc) {
    w.writeString(line);
  }
  w.writeListEnd();

  if (w.version >= 2013) w.writeString(model.longName || '');

  // Rule code sections
  if (w.version > 1005) {
    // Table lists
    writeStringList(w, model.tableSelection);
    writeStringList(w, model.tableInit);
    if (w.version >= 1036 && !(w.version >= 1100 && w.version <= 1103)) {
      writeStringList(w, model.tableFinalization);
      writeStringList(w, model.tableFunctions);
    }

    // Rule sections
    const sections = model.sections || {};
    writeTSRule(w, sections.preambleSelect);
    writeTSRule(w, sections.selection);
    writeTSRule(w, sections.initialization);

    if (w.version >= 1036 && !(w.version >= 1100 && w.version <= 1103)) {
      writeTSRule(w, sections.finalization);
      writeTSRule(w, sections.functionRule);
    }
  }

  if (w.version >= 2030) {
    writeTSRule(w, (model.sections || {}).printPage);
  }

  // ─── Entrance + logicalBuffer + breakList + exports + outputDefs ────
  // ParseGer skips all of this by scanning forward to "INICIO SECAO" / "FINAL MODELO".
  // Write inert padding (0x00 bytes) that won't confuse the vaString scanner.
  // Must be long enough that "FINAL MODELO" doesn't end up at buf.length boundary
  // (ParseGer's scan loop uses `i < buf.length - marker.length - 2` which is exclusive).
  for (let i = 0; i < 16; i++) w.writeRawByte(0x00);

  // ─── Band loop ──────────────────────────────────────────────────────
  for (const band of (model.bands || [])) {
    w.writeString('INICIO SECAO');
    const isDetail = (band._class === 'TSDetail' || band.bandType === 'DETALHE' ||
                      (band.tag >= 200 && band.tag <= 299));
    if (isDetail) {
      w.writeString('TSDetail');
      writeTSDetail(w, band);
    } else {
      w.writeString('TSBand');
      writeTSBand(w, band);
    }
    w.writeString('FINAL SECAO');
  }

  w.writeString('FINAL MODELO');

  // Trailing padding — ensures "FINAL MODELO" is within ParseGer's scanner range
  // (scanner uses `i < buf.length - marker.length - 2`, so we need ≥2 extra bytes)
  w.writeRawByte(0x00);
  w.writeRawByte(0x00);
  w.writeRawByte(0x00);
  w.writeRawByte(0x00);
}

// ─── Simplified JSON → Internal Model conversion ─────────────────────────────
// The ParseGer.js formatOutput() strips internal details. This function
// reconstructs the internal model from the simplified JSON format.
function simplifiedToInternal(json) {
  const model = {};

  // Direct fields
  model.binaryVersion = json.binaryVersion || 2025;
  model.version = json.version || 2061;
  model.systemVarVersion = json.systemVarVersion || 1001;
  model.caption = json.caption || 'Modelo Gerador';
  model.description = json.description || [];
  model.longName = json.longName || '';

  // Orientation
  if (typeof json.orientation === 'string') {
    model.orientation = json.orientation === 'Landscape' ? 1 : 0;
  } else {
    model.orientation = json.orientation || 0;
  }

  model.reportType = json.reportType != null ? json.reportType : 1;
  model.formatReport = json.formatReport != null ? json.formatReport : 0;

  // Geometry (defaults)
  model.top = json.top || 125;
  model.left = json.left || 2;
  model.width = json.width || 805;
  model.height = json.height || 559;

  // Font
  model.font = json.font || DEFAULTS.font;

  // Sections — convert string sources to rule objects
  model.sections = {};
  if (json.sections) {
    for (const [key, val] of Object.entries(json.sections)) {
      if (typeof val === 'string') {
        model.sections[key] = {
          propName: '',
          debug: false,
          number: 0,
          position: 0,
          lines: val ? val.split('\n') : [],
          source: val,
        };
      } else {
        model.sections[key] = val;
      }
    }
  }

  // Bands
  model.bands = (json.bands || []).map(b => {
    const band = { ...b };

    // Reconstruct position
    if (b.position) {
      band.top = b.position.top || 0;
      band.left = b.position.left || 0;
      band.width = b.position.width || 6000;
      band.height = b.position.height || 100;
    }

    // Convert rule strings to rule objects
    if (typeof b.onBeforePrint === 'string') {
      band.onBeforePrint = { ...DEFAULTS.rule, lines: b.onBeforePrint ? b.onBeforePrint.split('\n') : [], source: b.onBeforePrint || '' };
    }
    if (typeof b.onAfterPrint === 'string') {
      band.onAfterPrint = { ...DEFAULTS.rule, lines: b.onAfterPrint ? b.onAfterPrint.split('\n') : [], source: b.onAfterPrint || '' };
    }

    // Frame defaults
    band.frame = band.frame || DEFAULTS.frameDef;

    // Reconstruct children
    band.children = (b.children || []).map(c => {
      const child = { ...c };
      child._class = c.type || c._class || 'TSDescricao';

      // Reconstruct position
      if (c.position) {
        child.top = c.position.top || 0;
        child.left = c.position.left || 0;
        child.width = c.position.width || 100;
        child.height = c.position.height || 17;
      }

      // Reconstruct font
      if (c.font && typeof c.font === 'object' && !c.font.color) {
        child.font = { ...DEFAULTS.font, ...c.font };
      }

      // Convert onPrint string
      if (typeof c.onPrint === 'string') {
        child.onPrint = { ...DEFAULTS.rule, lines: c.onPrint ? c.onPrint.split('\n') : [], source: c.onPrint || '' };
      }

      return child;
    });

    return band;
  });

  // Break list
  model.breakList = json.breakList || [];

  // Table lists (empty defaults)
  model.tableSelection = json.tableSelection || [];
  model.tableInit = json.tableInit || [];
  model.tableFinalization = json.tableFinalization || [];
  model.tableFunctions = json.tableFunctions || [];

  return model;
}

// ─── Detect format: simplified (formatOutput) vs internal ─────────────────────
function isSimplifiedFormat(json) {
  // Simplified format has 'filename', 'sections' as strings, 'bands[].position'
  if (json.filename) return true;
  if (json.bands && json.bands[0] && json.bands[0].position) return true;
  if (json.sections && typeof Object.values(json.sections)[0] === 'string') return true;
  return false;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`WriteGer.js — Senior HCM .GER Report Model Writer (inverse of ParseGer.js)

Usage:
  node tools/WriteGer.js <input.json> [--output <file.raw>]   Write JSON to .raw
  node tools/WriteGer.js --stdin [--output <file.raw>]        Read JSON from stdin
  node tools/WriteGer.js --roundtrip <file.raw>               Parse→Write roundtrip test
  node tools/WriteGer.js --version=<ver> <input.json>         Use specific version

Options:
  --output <file>    Write to file (default: stdout or <input>.raw)
  --version=<n>      Binary format version (default: 2061)
  --roundtrip <f>    Parse .raw, write back, compare
  --verbose          Print stats to stderr`);
    process.exit(0);
  }

  const isStdin = args.includes('--stdin');
  const verbose = args.includes('--verbose');
  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : null;
  const verFlag = args.find(a => a.startsWith('--version='));
  const version = verFlag ? parseInt(verFlag.split('=')[1]) : 2061;

  // Roundtrip mode
  if (args[0] === '--roundtrip') {
    const rawPath = args[1];
    if (!rawPath) { console.error('Usage: --roundtrip <file.raw>'); process.exit(1); }
    runRoundtrip(rawPath, version, verbose);
    return;
  }

  // Read input JSON
  let jsonStr;
  if (isStdin) {
    jsonStr = fs.readFileSync('/dev/stdin', 'utf8');
  } else {
    const inputPath = args.find(a => !a.startsWith('--') && args.indexOf(a) !== outputIdx + 1 && a !== args[outputIdx]);
    if (!inputPath) { console.error('No input file specified'); process.exit(1); }
    jsonStr = fs.readFileSync(inputPath, 'utf8');
  }

  const json = JSON.parse(jsonStr);

  // Convert if simplified format
  const model = isSimplifiedFormat(json) ? simplifiedToInternal(json) : json;

  // Write
  const w = new TSWriter(256 * 1024);
  w.version = version;
  writeReportClass(w, model);
  const buf = w.getBuffer();

  if (outputPath) {
    fs.writeFileSync(outputPath, buf);
    if (verbose) console.error(`Written ${buf.length} bytes to ${outputPath}`);
  } else if (!isStdin) {
    const autoOutput = args.find(a => !a.startsWith('--')).replace(/\.json$/i, '.raw');
    fs.writeFileSync(autoOutput, buf);
    if (verbose) console.error(`Written ${buf.length} bytes to ${autoOutput}`);
    else console.log(`Written ${buf.length} bytes to ${autoOutput}`);
  } else {
    process.stdout.write(buf);
  }
}

function runRoundtrip(rawPath, version, verbose) {
  // Step 1: Parse original .raw with ParseGer
  const { execSync } = require('child_process');
  const parseGerPath = path.join(__dirname, 'ParseGer.js');

  if (verbose) console.error(`[1/4] Parsing ${rawPath} with ParseGer.js...`);
  const originalJson = JSON.parse(execSync(`node "${parseGerPath}" "${rawPath}"`, { maxBuffer: 50 * 1024 * 1024 }).toString());

  // Step 2: Convert to internal and write .raw
  if (verbose) console.error(`[2/4] Writing JSON → .raw with WriteGer.js...`);
  const model = isSimplifiedFormat(originalJson) ? simplifiedToInternal(originalJson) : originalJson;
  const w = new TSWriter(256 * 1024);
  w.version = version;
  writeReportClass(w, model);
  const roundtripBuf = w.getBuffer();

  // Step 3: Write temp file and re-parse
  const tmpPath = rawPath + '.roundtrip.raw';
  fs.writeFileSync(tmpPath, roundtripBuf);

  if (verbose) console.error(`[3/4] Re-parsing roundtrip .raw...`);
  const roundtripJson = JSON.parse(execSync(`node "${parseGerPath}" "${tmpPath}"`, { maxBuffer: 50 * 1024 * 1024 }).toString());

  // Step 4: Compare
  if (verbose) console.error(`[4/4] Comparing...`);

  const diffs = compareModels(originalJson, roundtripJson);

  // Clean up
  fs.unlinkSync(tmpPath);

  if (diffs.length === 0) {
    console.log(`ROUNDTRIP OK: ${path.basename(rawPath)} — ${roundtripBuf.length} bytes`);
    console.log(`  Original: ${originalJson._stats.totalBytes} bytes`);
    console.log(`  Roundtrip: ${roundtripBuf.length} bytes`);
    process.exit(0);
  } else {
    console.log(`ROUNDTRIP DIFFS: ${path.basename(rawPath)} — ${diffs.length} differences`);
    for (const d of diffs.slice(0, 30)) {
      console.log(`  ${d}`);
    }
    if (diffs.length > 30) console.log(`  ... and ${diffs.length - 30} more`);
    process.exit(1);
  }
}

function compareModels(a, b, prefix = '') {
  const diffs = [];
  // Compare key fields that matter for roundtrip
  const keys = ['caption', 'version', 'orientation', 'reportType', 'formatReport'];
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      diffs.push(`${prefix}${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`);
    }
  }

  // Compare sections
  if (a.sections && b.sections) {
    for (const k of Object.keys(a.sections)) {
      const aVal = (a.sections[k] || '').trim();
      const bVal = (b.sections[k] || '').trim();
      if (aVal !== bVal) {
        diffs.push(`sections.${k}: length ${aVal.length} → ${bVal.length}`);
      }
    }
  }

  // Compare bands
  const aBands = a.bands || [];
  const bBands = b.bands || [];
  if (aBands.length !== bBands.length) {
    diffs.push(`bands.length: ${aBands.length} → ${bBands.length}`);
  }
  const minBands = Math.min(aBands.length, bBands.length);
  for (let i = 0; i < minBands; i++) {
    const ab = aBands[i], bb = bBands[i];
    if (ab.name !== bb.name) diffs.push(`bands[${i}].name: ${ab.name} → ${bb.name}`);
    if (ab.tag !== bb.tag) diffs.push(`bands[${i}].tag: ${ab.tag} → ${bb.tag}`);
    if (ab.bandType !== bb.bandType) diffs.push(`bands[${i}].bandType: ${ab.bandType} → ${bb.bandType}`);

    const ac = ab.children || [], bc = bb.children || [];
    if (ac.length !== bc.length) {
      diffs.push(`bands[${i}].children.length: ${ac.length} → ${bc.length}`);
    }
    const minChildren = Math.min(ac.length, bc.length);
    for (let j = 0; j < minChildren; j++) {
      if (ac[j].type !== bc[j].type) diffs.push(`bands[${i}].children[${j}].type: ${ac[j].type} → ${bc[j].type}`);
      if (ac[j].name !== bc[j].name) diffs.push(`bands[${i}].children[${j}].name: ${ac[j].name} → ${bc[j].name}`);
      if (ac[j].caption !== bc[j].caption) diffs.push(`bands[${i}].children[${j}].caption: "${ac[j].caption}" → "${bc[j].caption}"`);
      if (ac[j].table !== bc[j].table) diffs.push(`bands[${i}].children[${j}].table: ${ac[j].table} → ${bc[j].table}`);
      if (ac[j].field !== bc[j].field) diffs.push(`bands[${i}].children[${j}].field: ${ac[j].field} → ${bc[j].field}`);
    }
  }

  return diffs;
}

// ─── Exports for programmatic use ─────────────────────────────────────────────
module.exports = {
  TSWriter,
  writeReportClass,
  simplifiedToInternal,
  isSimplifiedFormat,
  DEFAULTS,
  VT,
};

if (require.main === module) {
  main();
}
