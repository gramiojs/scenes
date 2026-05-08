import {
	createComposer,
	defineComposerMethods,
	eventTypes,
	type Next,
} from "@gramio/composer";
import {
	_composerMethods,
	type Bot,
	type Context,
	type ContextType,
	type ContextsMapping,
	type Handler,
	type Stringable,
	type UpdateName,
} from "gramio";
import type { SceneStepEntry } from "./scene-internals.js";

type AnyBot = Bot<any, any, any>;
type TelegramEventMap = {
	[K in keyof ContextsMapping<AnyBot>]: InstanceType<ContextsMapping<AnyBot>[K]>;
};

/**
 * Default event union for step builders. Mirrors the union .ask() uses today
 * (scene.ts:302) — most scene steps interact via text input or button presses.
 * Both contexts have `.send()`, so `c.enter(ctx => ctx.send("…"))` typechecks.
 *
 * Narrow with `c.events([...])` (chained) or `step("name", { events: [...] }, ...)`
 * (per-step option) when a step only accepts a subset.
 */
export type DefaultStepEvents = "message" | "callback_query";

/**
 * Per-step lifecycle hooks stored on the step composer's `~step` slot.
 * Read by Scene runtime in step 5/6 (next commits).
 */
export interface StepInternals {
	enter?: Handler<any>;
	exit?: Handler<any>;
	fallback?: Handler<any>;
	message?: Stringable | ((ctx: any) => Stringable | Promise<Stringable>);
	events?: readonly UpdateName[];
}

/**
 * Step builder context for the default event union (message + callback_query).
 * Both have `.send`, `.api`, `.from`, `.chat` — the common scene surface.
 */
export type StepCtx<E extends UpdateName = DefaultStepEvents> = ContextType<
	AnyBot,
	E
>;

/**
 * Lazily attach an empty StepInternals object on first use, then return it.
 */
function ensureStepInternals(target: unknown): StepInternals {
	const slot = target as { "~step"?: StepInternals };
	if (!slot["~step"]) slot["~step"] = {};
	return slot["~step"];
}

/**
 * Step-only methods layered on top of the gramio composer surface.
 *
 * These are thin wrappers — each stores a handler on `~step` for the Scene
 * runtime to invoke at the right lifecycle moment. None of them register
 * normal middleware on the composer itself.
 */
const stepLifecycleMethods = defineComposerMethods({
	/**
	 * Runs once when the user lands on this step (`firstTime === true`).
	 * Replaces the `if (context.scene.step.firstTime) return ctx.send(...)`
	 * boilerplate from the legacy step API.
	 */
	enter<TThis, E extends UpdateName = DefaultStepEvents>(
		this: TThis,
		handler: (ctx: StepCtx<E>, next: Next) => unknown,
	): TThis {
		ensureStepInternals(this).enter = handler as Handler<any>;
		return this;
	},

	/**
	 * Runs when the user leaves this step (next/previous/go from inside it,
	 * or scene.exit/reenter while it was current). Per-step counterpart to
	 * scene.onExit. Useful for cleanup and analytics.
	 */
	exit<TThis, E extends UpdateName = DefaultStepEvents>(
		this: TThis,
		handler: (ctx: StepCtx<E>, next: Next) => unknown,
	): TThis {
		ensureStepInternals(this).exit = handler as Handler<any>;
		return this;
	},

	/**
	 * Catch-all for events that didn't match any `.command/.on/.callbackQuery/
	 * .hears/.reaction` handler inside this step. Alternative to a final
	 * wildcard `.on(events, ...)`.
	 */
	fallback<TThis, E extends UpdateName = DefaultStepEvents>(
		this: TThis,
		handler: (ctx: StepCtx<E>, next: Next) => unknown,
	): TThis {
		ensureStepInternals(this).fallback = handler as Handler<any>;
		return this;
	},

	/**
	 * Sugar over `.enter(ctx => ctx.send(text))`. Accepts a literal Stringable
	 * or a factory that receives the entry context.
	 */
	message<TThis, E extends UpdateName = DefaultStepEvents>(
		this: TThis,
		text:
			| Stringable
			| ((ctx: StepCtx<E>) => Stringable | Promise<Stringable>),
	): TThis {
		ensureStepInternals(this).message = text as StepInternals["message"];
		return this;
	},

	/**
	 * Narrow the event whitelist for this step. Defaults to message +
	 * callback_query if not called. Mirrors `.on()`'s array-or-single shape.
	 *
	 * Type-only: returns `this` unchanged at the type level for v0. Manually
	 * annotate ctx if you need narrower types in lifecycle handlers. Full
	 * type narrowing is a follow-up.
	 */
	events<TThis, E extends UpdateName>(
		this: TThis,
		events: E | readonly E[],
	): TThis {
		ensureStepInternals(this).events = (
			Array.isArray(events) ? events : [events]
		) as readonly UpdateName[];
		return this;
	},

	/**
	 * Type-only declaration of the state shape this step contributes. No-op at
	 * runtime — exists so builder steps can opt into state inference until the
	 * automatic builder→state inference lands in a follow-up.
	 *
	 * @example
	 * c.updates<{ name: string }>().on("message", ctx => ctx.scene.update({ name: ctx.text! }))
	 */
	updates<TThis, _T>(this: TThis): TThis {
		return this;
	},
});

const stepMethods = { ..._composerMethods, ...stepLifecycleMethods };

/**
 * StepComposer — the per-step sub-composer exposed to `.step(c => c…)` builders.
 *
 * Has the full gramio surface (`.command`, `.callbackQuery`, `.hears`, `.on`,
 * `.use`, `.derive`, `.guard`, …) plus step-only lifecycle hooks
 * (`.enter`, `.exit`, `.fallback`, `.message`, `.events`, `.updates`).
 */
export const { Composer: StepComposer } = createComposer<
	Context<AnyBot>,
	TelegramEventMap,
	typeof stepMethods
>({
	discriminator: (ctx: Context<AnyBot>) => (ctx as any).updateType,
	types: eventTypes<TelegramEventMap>(),
	methods: stepMethods,
});

export type StepComposerInstance = InstanceType<typeof StepComposer>;

/**
 * Read step lifecycle hooks attached by `.enter/.exit/.fallback/.message/.events`.
 * Returns `undefined` if the builder never called any of them — the step has
 * only `.on`/`.command`/etc. handlers.
 */
export function getStepInternals(
	composer: StepComposerInstance,
): StepInternals | undefined {
	return (composer as unknown as { "~step"?: StepInternals })["~step"];
}

/**
 * Build a SceneStepEntry from a StepComposer instance + its id.
 * Used by Scene's `.step(builder)` overload (step 6).
 */
export function buildStepEntry(
	id: string | number,
	composer: StepComposerInstance,
): SceneStepEntry {
	const internals = getStepInternals(composer) ?? {};
	return {
		id,
		composer,
		enter: internals.enter,
		exit: internals.exit,
		fallback: internals.fallback,
		message: internals.message,
		events: internals.events,
	};
}
