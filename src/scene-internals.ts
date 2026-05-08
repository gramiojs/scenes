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
	State extends Record<string | number, any> = Record<string | number, any>,
> {
	steps: SceneStepEntry[];
	stepsCount: number;
	/** scene-level onEnter — single-arg, not middleware */
	enter?: SceneLifecycleHandler;
	/** scene-level onExit (lands in step 8) */
	exit?: SceneLifecycleHandler;
	isModule: boolean;
	// Type-only phantom carriers — never read at runtime, only used so
	// `params<T>()` / `state<T>()` / `exitData<T>()` can return a re-typed
	// Scene without runtime overhead.
	params: unknown;
	state: State;
	exitData: unknown;
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
