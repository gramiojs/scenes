import type { Storage } from "@gramio/storage";
import type { MaybePromise } from "gramio";
import type { AnyScene } from "./scene.js";

export type Modify<Base, Mod> = Omit<Base, keyof Mod> & Mod;

export type StateTypesDefault = Record<string | number, any>;

export type UpdateData<T extends StateTypesDefault> = {};

export interface ScenesOptions {
	storage?: Storage;
}

export interface ScenesStorageData<Params = any, State = any> {
	name: string;
	params: Params;
	state: State;
	stepId: number;
	previousStepId: number;
	firstTime: boolean;
}

// type ExtractedReturn<Return, State> = Return extends UpdateData<infer Type>
// 	? State & Type
// 	: State;

// type State = { bar: number };
// type Return = UpdateData<{ foo: string }> | { some: 2 };

export interface SceneUpdateState {
	/**
	 * @default sceneData.stepId + 1
	 */
	step?: number;
	firstTime?: boolean;
}

export type SceneEnterHandler<Scene extends AnyScene = AnyScene> = (
	scene: Scene,
	...args: Scene["_"]["params"] extends never
		? []
		: [params: Scene["_"]["params"]]
) => Promise<void>;

export interface EnterExit {
	enter: SceneEnterHandler;
	exit: () => MaybePromise<boolean>;
}

export type SceneStepReturn = {
	id: number;
	previousId: number;
	// TODO: isFirstTime ??
	firstTime: boolean;

	go: (stepId: number, firstTime?: boolean) => Promise<void>;

	next: () => Promise<void>;
	previous: () => Promise<void>;
};

export interface InActiveSceneHandlerReturn<
	Params,
	State extends StateTypesDefault,
> extends EnterExit {
	state: State;
	params: Params;
	update: <T extends StateTypesDefault>(
		state: T,
		options: SceneUpdateState,
	) => Promise<UpdateData<T>>;

	step: SceneStepReturn;
}
