/**
 * Convert snarkjs VK to Rust byte arrays for Solana groth16 verification
 */

const fs = require('fs');

// Read the VK
const vk = JSON.parse(fs.readFileSync('build/withdraw_simple_vk.json', 'utf-8'));

// Convert a field element to 32-byte big-endian
function toBigEndianBytes(str) {
    let hex = BigInt(str).toString(16).padStart(64, '0');
    let bytes = [];
    for (let i = 0; i < 64; i += 2) {
        bytes.push('0x' + hex.substring(i, i + 2));
    }
    return bytes;
}

// Format as Rust array
function formatRustArray(bytes, name, size) {
    let lines = [`pub const ${name}: [u8; ${size}] = [`];
    for (let i = 0; i < bytes.length; i += 16) {
        let chunk = bytes.slice(i, i + 16).join(', ') + ',';
        lines.push('    ' + chunk);
    }
    lines.push('];');
    return lines.join('\n');
}

// Convert G1 point (64 bytes)
function convertG1(point, name) {
    const x = toBigEndianBytes(point[0]);
    const y = toBigEndianBytes(point[1]);
    return formatRustArray([...x, ...y], name, 64);
}

// Convert G2 point (128 bytes, swapped for Solana)
function convertG2(point, name) {
    const x0 = toBigEndianBytes(point[0][0]);
    const x1 = toBigEndianBytes(point[0][1]);
    const y0 = toBigEndianBytes(point[1][0]);
    const y1 = toBigEndianBytes(point[1][1]);
    // Solana requires swapped order: x1, x0, y1, y0
    return formatRustArray([...x1, ...x0, ...y1, ...y0], name, 128);
}

console.log('// Generated VK for withdraw_simple circuit');
console.log('// Copy this to groth16.rs');
console.log('');

console.log(convertG1(vk.vk_alpha_1, 'VK_ALPHA_G1'));
console.log('');
console.log(convertG2(vk.vk_beta_2, 'VK_BETA_G2'));
console.log('');
console.log(convertG2(vk.vk_gamma_2, 'VK_GAMMA_G2'));
console.log('');
console.log(convertG2(vk.vk_delta_2, 'VK_DELTA_G2'));
console.log('');

for (let i = 0; i < vk.IC.length; i++) {
    console.log(convertG1(vk.IC[i], `IC_${i}`));
    console.log('');
}
