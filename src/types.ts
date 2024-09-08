import type { Storage } from "@gramio/storage";

export type Modify<Base, Mod> = Omit<Base, keyof Mod> & Mod;

export type StateTypesDefault = Record<string | number, any>;

export type UpdateData<T extends StateTypesDefault> = {};

export interface ScenesOptions {
	storage?: Storage;
}

export interface ScenesStorageData<Params, State> {
	name: string;
	params: Params;
	state: State;
	stepId: number;
	previousStepId: number;
	firstTime: boolean;
}
