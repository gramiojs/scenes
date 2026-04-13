import type { Storage } from "@gramio/storage";
import type { MaybePromise } from "gramio";
import type { AnyScene } from "./scene.js";

export type Modify<Base, Mod> = Omit<Base, keyof Mod> & Mod;

export type StateTypesDefault = Record<string | number, any>;

export type UpdateData<T extends StateTypesDefault> = {};

export type ScenesStorage = Storage<
	Record<
		`@gramio/scenes:${string | number}`,
		ScenesStorageData<unknown, unknown>
	>
>;

export interface ScenesOptions {
	storage?: ScenesStorage;
	/**
	 * Controls what happens to updates that arrive while the user is inside
	 * a scene but do not match the current step (wrong update type, or no
	 * step handler claims them).
	 *
	 * - `true` (default): non-matching updates fall through to the outer bot
	 *   chain, so global handlers like `.command("cancel")` or `.on("message")`
	 *   can still react. The scene's `firstTime` flag is preserved so the user
	 *   does not lose their place.
	 * - `false`: scenes greedily consume every update for the active user.
	 *   Legacy behavior — useful if you intentionally want to isolate the user
	 *   from outer handlers while a scene is active.
	 *
	 * @default true
	 */
	passthrough?: boolean;
}

export interface ParentSceneFrame {
	name: string;
	params: unknown;
	state: unknown;
	stepId: number;
	previousStepId: number;
	parentStack?: ParentSceneFrame[];
}

export interface ScenesStorageData<Params = any, State = any> {
	name: string;
	params: Params;
	state: State;
	stepId: number;
	previousStepId: number;
	firstTime: boolean;
	parentStack?: ParentSceneFrame[];
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

export type SceneEnterHandler = <Scene extends AnyScene>(
	scene: Scene,
	...args: Scene["~"]["params"] extends never
		? []
		: [params: Scene["~"]["params"]]
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
	ExitData extends Record<string, unknown> = Record<string, unknown>,
> extends EnterExit {
	state: State;
	params: Params;
	update: <T extends StateTypesDefault>(
		state: T,
		options?: SceneUpdateState,
	) => Promise<UpdateData<T>>;

	step: SceneStepReturn;

	reenter: (params?: Params) => Promise<void>;

	enterSub: SceneEnterHandler;
	exitSub: (returnData?: ExitData) => Promise<void>;
}

export interface InUnknownScene<
	Params,
	State extends StateTypesDefault,
	GlobalScene extends AnyScene | null = null,
> extends InActiveSceneHandlerReturn<Params, State> {
	is<Scene extends AnyScene>(
		scene: Scene,
	): this is InUnknownScene<Scene["~"]["params"], Scene["~"]["state"], Scene>;
}

export interface PossibleInUnknownScene<
	Params,
	State extends StateTypesDefault,
	Scene extends AnyScene | null = null,
> extends EnterExit {
	// TODO: currently higher is doesn't provide types here. this ternary is useless
	// but we should fix it somehow
	current: Scene extends AnyScene
		? InActiveSceneHandlerReturn<
				Scene["~"]["params"],
				Partial<Scene["~"]["state"]>
			>
		: InUnknownScene<Params, State, Scene> | undefined;
}
