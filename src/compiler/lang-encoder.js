/**
 * Senior HCM .LSP Binary Encoder
 *
 * Encodes .senior source code into the proprietary .LSP binary format
 * used by the Senior HCM rule engine (ASAS RTS).
 *
 * .LSP binary layout:
 *   0x00-0x01  Magic bytes (0x01 0x03)
 *   0x02-0x03  Zero padding
 *   0x04       Unknown (0x00)
 *   0x05       Module/version indicator (default 0x01)
 *   0x06-0x07  Zero padding
 *   0x08       Title length byte
 *   0x09-0x4F  Title string (Latin-1) + zero padding
 *   0x50-0x5F  MD5 hash/checksum (ZEROED — algorithm unknown)
 *   0x60-0x67  Unknown metadata (zero-fill)
 *   0x68+      XOR-encoded source body
 */

import { randomInt } from 'node:crypto';

/** Header size in bytes (everything before the encoded body). */
const HEADER_SIZE = 0x68;

/** Offset where the MD5 hash field begins. */
const MD5_OFFSET = 0x50;

/** Maximum title length stored in the header. */
const MAX_TITLE_LENGTH = 70;

/** Offset where the title string begins. */
const TITLE_OFFSET = 0x09;

/**
 * Pick a random XOR key byte that won't cause problems.
 * Excludes 0x00 (no-op) and 0x20 (space — would make frequency analysis
 * on the encoded output trivially reveal the key).
 *
 * @returns {number} A byte in 0x01-0xFF, excluding 0x20.
 */
function pickXorKey() {
  let key;
  do {
    key = randomInt(1, 256); // 1..255 inclusive
  } while (key === 0x20);
  return key;
}

/**
 * Encode .senior source code to .LSP binary format.
 *
 * @param {string} source - Senior rule language source code
 * @param {string} [title=''] - Rule title (max 70 chars, stored in header)
 * @returns {{ buffer: Buffer, key: number, warnings: string[] }}
 */
export function encodeLsp(source, title = '') {
  const warnings = [];

  // --- Validate source ---
  if (!source || source.length === 0) {
    throw new Error('Source code must not be empty.');
  }

  // --- Process title ---
  let effectiveTitle = title;
  if (effectiveTitle.length > MAX_TITLE_LENGTH) {
    effectiveTitle = effectiveTitle.slice(0, MAX_TITLE_LENGTH);
    warnings.push(
      `Title truncated from ${title.length} to ${MAX_TITLE_LENGTH} characters.`
    );
  }

  // --- Encode source body to Latin-1 ---
  const sourceBuffer = Buffer.from(source, 'latin1');

  // --- Pick XOR key ---
  const key = pickXorKey();

  // --- XOR-encode the source body ---
  const encodedBody = Buffer.alloc(sourceBuffer.length);
  for (let i = 0; i < sourceBuffer.length; i++) {
    encodedBody[i] = sourceBuffer[i] ^ key;
  }

  // --- Build the header (0x68 bytes, zero-initialized) ---
  const header = Buffer.alloc(HEADER_SIZE);

  // Magic bytes
  header[0x00] = 0x01;
  header[0x01] = 0x03;
  // 0x02-0x03 remain 0x00 (padding)
  // 0x04 remains 0x00 (unknown)
  header[0x05] = 0x01; // module/version indicator
  // 0x06-0x07 remain 0x00 (padding)

  // Title length + title string (Latin-1)
  const titleBytes = Buffer.from(effectiveTitle, 'latin1');
  header[0x08] = titleBytes.length;
  titleBytes.copy(header, TITLE_OFFSET, 0, titleBytes.length);
  // Remaining bytes from end-of-title to 0x4F are already zero (padding)

  // 0x50-0x5F: MD5 hash — left as zeros (algorithm unknown)
  // 0x60-0x67: unknown metadata — left as zeros

  // --- Concatenate header + encoded body ---
  const buffer = Buffer.concat([header, encodedBody]);

  // --- Always warn about zeroed hash ---
  warnings.push(
    'MD5 hash field at offset 0x50-0x5F is zeroed. The Senior runtime may ' +
    'not accept this file without a valid hash. For deployment, use the ' +
    'desktop client rule editor or write directly to R960RUL in the database.'
  );

  return { buffer, key, warnings };
}
