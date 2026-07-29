import type { Handler, Stringable } from "gramio";

export type SceneLifecycleHandler = (ctx: any) => unknown | Promise<unknown>;

/**
 * Per-step record stored on a Scene's `~scene.steps` array.
 *
 * Each step is a sub-composer (StepComposer) plus lifecycle hooks
 * registered via `c.enter()` / `c.exit()` / `c.fallback()` / `c.message()`.
 *
 * `composer` is typed as `unknown` here to avoid a circular import with
 * `step-composer.ts`; consumers cast to the concrete StepComposer type at
 * the use site.
 */
export interface SceneStepEntry {
	id: string | number;
	composer: unknown;
	/**
	 * `true` for legacy event-filtered steps (`scene.step("message", handler)`
	 * and everything built on top of it, like `.ask`). Their handler lives in
	 * the scene composer chain as a gated `.use()` middleware, not in a
	 * StepComposer — `composer` is `undefined` and the runtime dispatches them
	 * through the legacy path.
	 *
	 * The entry still exists so that `~scene.steps` is a complete, ordered
	 * registry of every step: `getSceneEnter` picks `steps[0]` as the initial
	 * step and `.update()` / `.step.next()` / `.step.previous()` walk this
	 * array. Without a placeholder, a legacy step sitting between builder steps
	 * would be silently skipped.
	 */
	legacy?: boolean;
	enter?: Handler<any>;
	exit?: Handler<any>;
	fallback?: Handler<any>;
	/**
	 * Sugar set by `c.message(text | factory)`. When present and the step's
	 * `enter` hook is not, the runtime sends this on first entry.
	 */
	message?: Stringable | ((ctx: any) => Stringable | Promise<Stringable>);
	/**
	 * Event whitelist set by `c.events(["message"])` or step options.
	 * `undefined` ⇒ default (`"message" | "callback_query"`).
	 */
	events?: readonly string[];
}

/**
 * Scene-specific state that lives alongside the Composer's `~` slot.
 * Stored at `scene["~scene"]` to avoid colliding with composer internals
 * and to keep augmentation of `@gramio/composer` unnecessary.
 */
export interface SceneInternals<
	Params = unknown,
	State extends Record<string | number, any> = Record<string | number, any>,
	ExitData = unknown,
> {
	steps: SceneStepEntry[];
	stepsCount: number;
	/** scene-level onEnter — single-arg, not middleware */
	enter?: SceneLifecycleHandler;
	/** scene-level onExit (lands in step 8) */
	exit?: SceneLifecycleHandler;
	isModule: boolean;
	// Type-only carriers — never read at runtime, used so `params<T>()` /
	// `state<T>()` / `exitData<T>()` carry the user's types through Scene's
	// structural shape (so `Scene<{id}>` and `Scene<never>` are distinct
	// types at the call-site level — needed for SceneEnterHandler arity).
	params: Params;
	state: State;
	exitData: ExitData;
}

export function createSceneInternals(name: string | undefined): SceneInternals {
	return {
		steps: [],
		stepsCount: 0,
		enter: undefined,
		exit: undefined,
		isModule: name === undefined,
		params: undefined,
		state: {} as Record<string | number, any>,
		exitData: undefined,
	};
}
