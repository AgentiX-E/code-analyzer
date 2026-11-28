/**
 * **The declaration for `device-price.mjs`.**
 *
 * Prices one configuration switch against a banked arm on the rows both covered, and refuses a pair that differs in
 * more than the device key or that covered different rows.
 */

/** The configuration key a priced device differs in (the artifact records it as `laneSet`). */
export const DEVICE_KEY: string;

/** Fields a caller may explicitly declare as dispatch-entailed rather than device. */
export const DISPATCH_ENTAILED_KEYS: readonly string[];

/** The measured same-configuration day-to-day F1 drift. */
export const CROSS_DISPATCH_DRIFT: number;

export class PriceDeviceError extends Error {
  constructor(message: string);
}

/** Which configuration keys differ between two artifacts. */
export function variedKeys(base: unknown, device: unknown): string[];

/** The reconciled Code Defect (`bug`) TP an artifact declares in its byCategory decomposition. */
export function codeDefectTruePositives(artifact: unknown): number;

export interface DevicePrice {
  readonly varied: readonly string[];
  readonly ignoredDispatchEntailed: readonly string[];
  /** The number of pull requests both arms scored. */
  readonly pullRequests: number;
  readonly coverage: {
    readonly base: number;
    readonly device: number;
    readonly both: number;
  };
  readonly pValue: number;
  readonly codeDefect: {
    readonly base: number;
    readonly device: number;
    readonly delta: number;
  };
  readonly f1: {
    readonly base: number;
    readonly device: number;
    readonly delta: number;
  };
  readonly pairing: 'within-dispatch' | 'cross-dispatch';
  readonly driftCaveat: string | null;
}

export function priceDevice(options: {
  readonly base: unknown;
  readonly device: unknown;
  readonly dispatch?: 'same' | 'cross';
  readonly ignoreKeys?: readonly string[];
}): DevicePrice;
