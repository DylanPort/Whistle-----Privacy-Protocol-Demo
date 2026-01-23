/**
 * WHISTLE PROTOCOL - Client-Side Proof Generator
 * 
 * TypeScript SDK for generating ZK proofs for Whistle Protocol operations:
 * - withdraw_merkle: Full withdrawal with Merkle proof
 * - unshield_change: Withdrawal with change re-shielding
 * - private_transfer: Shielded balance transfers
 * 
 * Usage:
 *   import { WhistleProver } from './proof-generator';
 *   const prover = new WhistleProver();
 *   const proof = await prover.generateWithdrawProof(...);
 */

import { groth16 } from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';
import * as crypto from 'crypto';

// BN254 scalar field prime (Fr)
const FIELD_PRIME = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
// BN254 base field prime (Fq) for curve points
const BN254_BASE_FIELD = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');

/**
 * Note structure for the protocol
 */
export interface Note {
    secret: bigint;
    nullifier: bigint;
    amount: bigint;
    commitment: bigint;
    nullifierHash: bigint;
    leafIndex?: number;
}

/**
 * Merkle proof structure
 */
export interface MerkleProof {
    pathElements: bigint[];
    pathIndices: number[];
    root: bigint;
}

/**
 * Formatted proof for Solana submission
 */
export interface SolanaProof {
    proof_a: number[];
    proof_b: number[];
    proof_c: number[];
}

/**
 * Whistle Protocol Prover
 */
export class WhistleProver {
    private poseidon: any;
    private initialized: boolean = false;
    
    // Circuit file paths (relative to build/production)
    private circuitPaths = {
        withdraw_merkle: {
            wasm: 'withdraw_merkle/withdraw_merkle_js/withdraw_merkle.wasm',
            zkey: 'withdraw_merkle/withdraw_merkle_final.zkey'
        },
        unshield_change: {
            wasm: 'unshield_change/unshield_change_js/unshield_change.wasm',
            zkey: 'unshield_change/unshield_change_final.zkey'
        },
        private_transfer: {
            wasm: 'private_transfer/private_transfer_js/private_transfer.wasm',
            zkey: 'private_transfer/private_transfer_final.zkey'
        }
    };

    /**
     * Initialize the prover (must be called before generating proofs)
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        
        this.poseidon = await buildPoseidon();
        this.initialized = true;
    }

    /**
     * Generate a random field element
     */
    randomFieldElement(): bigint {
        const bytes = crypto.randomBytes(32);
        let n = BigInt('0x' + bytes.toString('hex'));
        return n % (FIELD_PRIME - 1n) + 1n;
    }

    /**
     * Compute Poseidon hash
     */
    poseidonHash(inputs: bigint[]): bigint {
        if (!this.initialized) {
            throw new Error('Prover not initialized. Call initialize() first.');
        }
        const hash = this.poseidon(inputs.map(i => this.poseidon.F.e(i.toString())));
        return BigInt(this.poseidon.F.toString(hash));
    }

    /**
     * Create a new note
     */
    createNote(amount: bigint): Note {
        const secret = this.randomFieldElement();
        const nullifier = this.randomFieldElement();
        
        // commitment = Poseidon(secret, Poseidon(nullifier, amount))
        const innerHash = this.poseidonHash([nullifier, amount]);
        const commitment = this.poseidonHash([secret, innerHash]);
        
        // nullifierHash = Poseidon(nullifier, 0)
        const nullifierHash = this.poseidonHash([nullifier, 0n]);
        
        return {
            secret,
            nullifier,
            amount,
            commitment,
            nullifierHash
        };
    }

    /**
     * Convert snarkjs proof to Solana format (big-endian byte arrays)
     */
    formatProofForSolana(proof: any): SolanaProof {
        // Convert proof points to byte arrays
        const proof_a = this.g1ToBytesNegated(proof.pi_a);
        const proof_b = this.g2ToBytes(proof.pi_b);
        const proof_c = this.g1ToBytes(proof.pi_c);
        
        return { proof_a, proof_b, proof_c };
    }

    /**
     * Convert G1 point to 64 bytes (big-endian)
     */
    private g1ToBytes(point: string[]): number[] {
        const x = this.bigintToBytes(BigInt(point[0]), 32);
        const y = this.bigintToBytes(BigInt(point[1]), 32);
        return [...x, ...y];
    }

    /**
     * Convert G1 point to 64 bytes (big-endian) with negated Y
     * Required by groth16-solana verifier.
     */
    private g1ToBytesNegated(point: string[]): number[] {
        const x = BigInt(point[0]);
        const y = BigInt(point[1]) % BN254_BASE_FIELD;
        const yNeg = y === 0n ? 0n : BN254_BASE_FIELD - y;
        const xBytes = this.bigintToBytes(x, 32);
        const yBytes = this.bigintToBytes(yNeg, 32);
        return [...xBytes, ...yBytes];
    }

    /**
     * Convert G2 point to 128 bytes (big-endian, swapped for Solana)
     */
    private g2ToBytes(point: string[][]): number[] {
        // snarkjs format: [[x0, x1], [y0, y1]]
        // Solana format: [x1, x0, y1, y0]
        const x0 = this.bigintToBytes(BigInt(point[0][0]), 32);
        const x1 = this.bigintToBytes(BigInt(point[0][1]), 32);
        const y0 = this.bigintToBytes(BigInt(point[1][0]), 32);
        const y1 = this.bigintToBytes(BigInt(point[1][1]), 32);
        
        return [...x1, ...x0, ...y1, ...y0];
    }

    /**
     * Convert bigint to big-endian byte array
     */
    private bigintToBytes(n: bigint, length: number): number[] {
        const bytes: number[] = [];
        for (let i = 0; i < length; i++) {
            bytes.unshift(Number(n & 0xFFn));
            n >>= 8n;
        }
        return bytes;
    }

    /**
     * Generate withdrawal proof (withdraw_merkle circuit)
     */
    async generateWithdrawProof(
        note: Note,
        merkleProof: MerkleProof,
        recipient: bigint,
        amount: bigint,
        relayerFee: bigint,
        basePath: string = './build/production'
    ): Promise<{ proof: SolanaProof; publicSignals: bigint[] }> {
        if (!this.initialized) {
            throw new Error('Prover not initialized');
        }

        // Verify note has enough balance
        if (note.amount < amount + relayerFee) {
            throw new Error('Insufficient note balance');
        }

        const input = {
            // Public inputs
            merkleRoot: merkleProof.root.toString(),
            nullifierHash: note.nullifierHash.toString(),
            recipient: recipient.toString(),
            amount: amount.toString(),
            relayerFee: relayerFee.toString(),
            
            // Private inputs
            secret: note.secret.toString(),
            nullifier: note.nullifier.toString(),
            noteAmount: note.amount.toString(),
            pathElements: merkleProof.pathElements.map(e => e.toString()),
            pathIndices: merkleProof.pathIndices.map(i => i.toString())
        };

        const wasmPath = `${basePath}/${this.circuitPaths.withdraw_merkle.wasm}`;
        const zkeyPath = `${basePath}/${this.circuitPaths.withdraw_merkle.zkey}`;

        const { proof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);
        
        return {
            proof: this.formatProofForSolana(proof),
            publicSignals: publicSignals.map((s: string) => BigInt(s))
        };
    }

    /**
     * Generate unshield with change proof
     */
    async generateUnshieldChangeProof(
        note: Note,
        merkleProof: MerkleProof,
        recipient: bigint,
        withdrawalAmount: bigint,
        relayerFee: bigint,
        basePath: string = './build/production'
    ): Promise<{ 
        proof: SolanaProof; 
        publicSignals: bigint[];
        changeNote: Note | null;
    }> {
        if (!this.initialized) {
            throw new Error('Prover not initialized');
        }

        // Calculate change
        const changeAmount = note.amount - withdrawalAmount - relayerFee;
        
        if (changeAmount < 0n) {
            throw new Error('Insufficient note balance');
        }

        // Create change note if there's change
        let changeNote: Note | null = null;
        let changeCommitment = 0n;
        let changeSecret = 0n;
        let changeNullifier = 0n;
        
        if (changeAmount > 0n) {
            changeNote = this.createNote(changeAmount);
            changeCommitment = changeNote.commitment;
            changeSecret = changeNote.secret;
            changeNullifier = changeNote.nullifier;
        }

        const input = {
            // Public inputs
            merkleRoot: merkleProof.root.toString(),
            nullifierHash: note.nullifierHash.toString(),
            recipient: recipient.toString(),
            withdrawalAmount: withdrawalAmount.toString(),
            relayerFee: relayerFee.toString(),
            changeCommitment: changeCommitment.toString(),
            
            // Private inputs - input note
            secret: note.secret.toString(),
            nullifier: note.nullifier.toString(),
            noteAmount: note.amount.toString(),
            pathElements: merkleProof.pathElements.map(e => e.toString()),
            pathIndices: merkleProof.pathIndices.map(i => i.toString()),
            
            // Private inputs - change note
            changeSecret: changeSecret.toString(),
            changeNullifier: changeNullifier.toString(),
            changeAmount: changeAmount.toString()
        };

        const wasmPath = `${basePath}/${this.circuitPaths.unshield_change.wasm}`;
        const zkeyPath = `${basePath}/${this.circuitPaths.unshield_change.zkey}`;

        const { proof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);
        
        return {
            proof: this.formatProofForSolana(proof),
            publicSignals: publicSignals.map((s: string) => BigInt(s)),
            changeNote
        };
    }

    /**
     * Generate private transfer proof
     */
    async generatePrivateTransferProof(
        inputNotes: [Note, Note | null],
        inputMerkleProofs: [MerkleProof, MerkleProof | null],
        outputAmounts: [bigint, bigint],
        basePath: string = './build/production'
    ): Promise<{
        proof: SolanaProof;
        publicSignals: bigint[];
        outputNotes: [Note, Note | null];
    }> {
        if (!this.initialized) {
            throw new Error('Prover not initialized');
        }

        // Calculate totals
        const totalInput = inputNotes[0].amount + (inputNotes[1]?.amount || 0n);
        const totalOutput = outputAmounts[0] + outputAmounts[1];
        
        if (totalInput !== totalOutput) {
            throw new Error('Input and output amounts must be equal');
        }

        // Create output notes
        const outNote1 = this.createNote(outputAmounts[0]);
        const outNote2 = outputAmounts[1] > 0n ? this.createNote(outputAmounts[1]) : null;

        // Prepare input for circuit
        const emptyProof = { 
            pathElements: Array(10).fill(0n), 
            pathIndices: Array(10).fill(0),
            root: 0n 
        };
        const emptyNote: Note = {
            secret: 0n,
            nullifier: 0n,
            amount: 0n,
            commitment: 0n,
            nullifierHash: 0n
        };

        const in1 = inputNotes[0];
        const in2 = inputNotes[1] || emptyNote;
        const proof1 = inputMerkleProofs[0];
        const proof2 = inputMerkleProofs[1] || emptyProof;

        const input = {
            // Public inputs
            merkleRoot: proof1.root.toString(),
            inputNullifierHashes: [
                in1.nullifierHash.toString(),
                in2.amount > 0n ? in2.nullifierHash.toString() : '0'
            ],
            outputCommitments: [
                outNote1.commitment.toString(),
                outNote2?.commitment.toString() || '0'
            ],
            
            // Private inputs - Input 1
            inSecret1: in1.secret.toString(),
            inNullifier1: in1.nullifier.toString(),
            inAmount1: in1.amount.toString(),
            inPathElements1: proof1.pathElements.map(e => e.toString()),
            inPathIndices1: proof1.pathIndices.map(i => i.toString()),
            
            // Private inputs - Input 2
            inSecret2: in2.secret.toString(),
            inNullifier2: in2.nullifier.toString(),
            inAmount2: in2.amount.toString(),
            inPathElements2: proof2.pathElements.map(e => e.toString()),
            inPathIndices2: proof2.pathIndices.map(i => i.toString()),
            
            // Private inputs - Output 1
            outSecret1: outNote1.secret.toString(),
            outNullifier1: outNote1.nullifier.toString(),
            outAmount1: outNote1.amount.toString(),
            
            // Private inputs - Output 2
            outSecret2: outNote2?.secret.toString() || '0',
            outNullifier2: outNote2?.nullifier.toString() || '0',
            outAmount2: outNote2?.amount.toString() || '0'
        };

        const wasmPath = `${basePath}/${this.circuitPaths.private_transfer.wasm}`;
        const zkeyPath = `${basePath}/${this.circuitPaths.private_transfer.zkey}`;

        const { proof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);
        
        return {
            proof: this.formatProofForSolana(proof),
            publicSignals: publicSignals.map((s: string) => BigInt(s)),
            outputNotes: [outNote1, outNote2]
        };
    }
}

// Export singleton instance
export const whistleProver = new WhistleProver();
