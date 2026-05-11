import type { Storage } from "@gramio/storage";
import type { MaybePromise } from "gramio";
import type { AnyScene, Scene } from "./scene.js";

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
	stepId: string | number;
	previousStepId: string | number;
	parentStack?: ParentSceneFrame[];
}

export interface ScenesStorageData<Params = any, State = any> {
	name: string;
	params: Params;
	state: State;
	stepId: string | number;
	previousStepId: string | number;
	firstTime: boolean;
	parentStack?: ParentSceneFrame[];
	/**
	 * `true` once `scene.onEnter` has fired for this occupancy of the scene.
	 * Used to distinguish "scene first entry" (fire onEnter) from "step
	 * transition with firstTime=true" (don't re-fire onEnter). Defaults to
	 * `false` on initial entry and is set `true` by dispatchActive after
	 * onEnter runs.
	 */
	entered?: boolean;
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
	step?: string | number;
	firstTime?: boolean;
}

/**
 * Extracts the Params generic from a Scene type. Reads from the SCENE
 * GENERIC, not from the runtime `~scene.params` carrier (which is typed
 * `unknown` at the class field level and never round-trips the user's
 * type back out). This is what lets `enter(scene)` reject a missing
 * params arg and enforce the declared shape when one is required.
 */
type SceneParamsOf<S> = S extends Scene<infer P, any, any, any> ? P : never;

/**
 * `enter(scene, params?)` typed via two overloads so each case is checked
 * cleanly without relying on a conditional-rest-args dance (which expect-
 * type's `toBeCallableWith` can't fully resolve under generic constraints):
 *
 *   • If the Scene declares `Params = never` (never called `.params<T>()`),
 *     `enter(scene)` is valid with no second argument.
 *   • If the Scene declares params, `enter(scene, params)` is required and
 *     the params shape is enforced against the declared type.
 */
export interface SceneEnterHandler {
	<S extends Scene<never, any, any, any>>(scene: S): Promise<void>;
	<S extends AnyScene>(scene: S, params: SceneParamsOf<S>): Promise<void>;
}

export interface EnterExit {
	enter: SceneEnterHandler;
	exit: () => MaybePromise<boolean>;
}

export type SceneStepReturn = {
	id: string | number;
	previousId: string | number;
	// TODO: isFirstTime ??
	firstTime: boolean;

	go: (stepId: string | number, firstTime?: boolean) => Promise<void>;

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
	): this is InUnknownScene<Scene["~scene"]["params"], Scene["~scene"]["state"], Scene>;
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
				Scene["~scene"]["params"],
				Partial<Scene["~scene"]["state"]>
			>
		: InUnknownScene<Params, State, Scene> | undefined;
}
