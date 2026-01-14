declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: Record<string, string>,
      wasmPath: string,
      zkeyPath: string
    ): Promise<{
      proof: {
        pi_a: string[];
        pi_b: string[][];
        pi_c: string[];
      };
      publicSignals: string[];
    }>;
    verify(
      vk: any,
      publicSignals: string[],
      proof: any
    ): Promise<boolean>;
  };
}

declare module 'circomlibjs' {
  export function buildPoseidon(): Promise<{
    F: {
      toObject(x: any): bigint;
    };
    (inputs: bigint[]): any;
  }>;
}

