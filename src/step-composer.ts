import {
	type EventComposer,
	type EventContextOf,
	createComposer,
	defineComposerMethods,
	eventTypes,
	type Next,
} from "@gramio/composer";
import {
	_composerMethods,
	type Bot,
	type CallbackData,
	type Context,
	type ContextType,
	type ContextsMapping,
	type Handler,
	type Stringable,
	type UpdateName,
} from "gramio";
import type { SceneStepEntry } from "./scene-internals.js";
import type { UpdateData } from "./types.js";

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
 * Step builder context for the default event union (message + callback_query),
 * merged with anything `this` has accumulated (scene-level derives, step-level
 * derives) via `ContextOf<TThis>` / `EventContextOf<TThis, E>`.
 *
 * `EventContextOf` picks up both the global TOut AND per-event TDerives, so
 * derives registered with `.derive("message", ...)` are visible too.
 *
 * Both default-union contexts have `.send`, `.api`, `.from`, `.chat` — the
 * common scene surface.
 */
export type StepCtx<
	TThis,
	E extends UpdateName = DefaultStepEvents,
> = ContextType<AnyBot, E> & EventContextOf<TThis, E>;

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
		handler: (ctx: StepCtx<TThis, E>, next: Next) => unknown,
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
		handler: (ctx: StepCtx<TThis, E>, next: Next) => unknown,
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
		handler: (ctx: StepCtx<TThis, E>, next: Next) => unknown,
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
			| ((ctx: StepCtx<TThis, E>) => Stringable | Promise<Stringable>),
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
	/**
	 * @returns the same composer instance, with no type change. TThis is
	 * inferred from the binding; if you call it as `c.updates<T>()`, the
	 * return is typed as `c`.
	 */
	updates<_T, TThis = unknown>(this: TThis): TThis {
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
 * StepComposer instance pre-seeded with the parent Scene's derives in TOut.
 *
 * This is the type you want at `c => c…` callsites — it carries `ctx.scene`,
 * any scene-level `.derive(...)`-injected fields, and any `.extend(plugin)`
 * derives all the way into the step's `.enter / .on / .command / ...`
 * handlers. Without this threading, step ctx is plain
 * `MessageContext | CallbackQueryContext` and `ctx.scene.update(...)` /
 * `ctx.scene.exit()` would not type-check.
 *
 * The Scene's Derives generic looks like:
 *   `{ global: { scene: ... } & UserDerives; message: ...; callback_query: ... }`
 *
 * We pull `Derives["global"]` into TOut so it's visible on every step ctx,
 * and pull the per-event slots into TDerives so `.on("message", ...)` /
 * `.command(...)` handlers receive the right narrowed shape too.
 *
 * Generic order: the parent scene's `Derives` is what we need; we accept
 * the whole Scene type and project just that slot to keep callers from
 * having to extract by hand.
 */
export type StepComposerFor<
	TSceneDerives extends { global: object } = { global: {} },
	AccState extends object = {},
> = StepComposerStateTracked<
	EventComposer<
		Context<AnyBot>,
		TelegramEventMap,
		Context<AnyBot>,
		Context<AnyBot> & TSceneDerives["global"],
		{},
		Omit<TSceneDerives, "global"> extends Record<string, object>
			? Omit<TSceneDerives, "global">
			: {},
		typeof stepMethods
	> &
		typeof stepMethods,
	TSceneDerives,
	AccState
>;

/**
 * Extracts the state contribution from a handler's awaited return type.
 *
 * `ctx.scene.update({ k: v })` returns `Promise<UpdateData<{ k: v }>>`, so
 * `update({k:v})` returns are picked up automatically. Returning
 * `void`/`undefined`/`Promise<void>` from a handler contributes nothing
 * (`{}`), so handlers that only send messages don't pollute the state.
 *
 * Mirrors `Awaited<ReturnType<Handler>>` extraction already done by the
 * legacy `step(event, handler)` overload in scene.ts — this generalises
 * the same trick to every event-handler method on the step builder.
 */
export type ExtractUpdateState<R> = Awaited<R> extends UpdateData<infer T>
	? T
	: {};

/**
 * Re-typed view of a step composer where each event-handler method
 * (`.on / .command / .callbackQuery / .hears / .enter / .exit / .fallback`)
 * accumulates `Awaited<ReturnType<H>>` into a phantom `AccState` generic.
 *
 * The accumulated state is what `Scene.step(...)` reads off the builder's
 * return type to widen the Scene's `State` generic — so that
 * `ctx.scene.state.X` is properly typed in subsequent step handlers
 * without any `.state<T>()` annotation.
 *
 * Conceptually: `c.on("message", ctx => ctx.scene.update({ name: ctx.text }))`
 * threads `{ name: string }` into the step's `AccState`; on the next step's
 * `ctx.scene.state` you see `{ name: string }` typed in.
 */
/**
 * Mirror of gramio's `EventContextOf<TThis, E>` projected against a Scene's
 * `Derives` slot — merges the scene-level global derives plus any per-event
 * derives registered via `scene.derive("<event>", ...)` so that step handlers
 * see the same shape gramio's bot-level handlers would.
 *
 * `Derives` slots default to `{}` (see `DeriveDefinitions` in gramio), so the
 * `keyof` conditional safely degrades when an event has no entry.
 */
type StepEventCtx<
	E extends UpdateName,
	TSceneDerives extends { global: object },
> = ContextType<AnyBot, E> &
	TSceneDerives["global"] &
	(E extends keyof TSceneDerives ? TSceneDerives[E] : {});

export type StepComposerStateTracked<
	TBase,
	TSceneDerives extends { global: object },
	AccState extends object,
> = Omit<
	TBase,
	"on" | "command" | "callbackQuery" | "hears" | "enter" | "exit" | "fallback"
> & {
	on<
		E extends UpdateName,
		H extends (ctx: StepEventCtx<E, TSceneDerives>, next: Next) => unknown,
	>(
		event: E | readonly E[],
		handler: H,
	): StepComposerStateTracked<
		TBase,
		TSceneDerives,
		AccState & ExtractUpdateState<ReturnType<H>>
	>;

	command<
		H extends (
			ctx: StepEventCtx<"message", TSceneDerives> & { args: string | null },
		) => unknown,
	>(
		name: string | readonly string[],
		handler: H,
	): StepComposerStateTracked<
		TBase,
		TSceneDerives,
		AccState & ExtractUpdateState<ReturnType<H>>
	>;

	callbackQuery<
		Trigger extends CallbackData | string | RegExp,
		H extends (
			ctx: StepEventCtx<"callback_query", TSceneDerives> & {
				queryData: Trigger extends CallbackData
					? ReturnType<Trigger["unpack"]>
					: Trigger extends RegExp
						? RegExpMatchArray
						: never;
			},
		) => unknown,
	>(
		trigger: Trigger,
		handler: H,
	): StepComposerStateTracked<
		TBase,
		TSceneDerives,
		AccState & ExtractUpdateState<ReturnType<H>>
	>;

	hears<
		H extends (
			ctx: StepEventCtx<"message", TSceneDerives> & {
				args: RegExpMatchArray | null;
			},
		) => unknown,
	>(
		trigger:
			| RegExp
			| string
			| readonly string[]
			| ((ctx: ContextType<AnyBot, "message">) => boolean),
		handler: H,
	): StepComposerStateTracked<
		TBase,
		TSceneDerives,
		AccState & ExtractUpdateState<ReturnType<H>>
	>;

	enter<
		E extends UpdateName = DefaultStepEvents,
		H extends (ctx: StepEventCtx<E, TSceneDerives>, next: Next) => unknown = (
			ctx: StepEventCtx<E, TSceneDerives>,
			next: Next,
		) => unknown,
	>(
		handler: H,
	): StepComposerStateTracked<
		TBase,
		TSceneDerives,
		AccState & ExtractUpdateState<ReturnType<H>>
	>;

	exit<
		E extends UpdateName = DefaultStepEvents,
		H extends (ctx: StepEventCtx<E, TSceneDerives>, next: Next) => unknown = (
			ctx: StepEventCtx<E, TSceneDerives>,
			next: Next,
		) => unknown,
	>(
		handler: H,
	): StepComposerStateTracked<
		TBase,
		TSceneDerives,
		AccState & ExtractUpdateState<ReturnType<H>>
	>;

	fallback<
		E extends UpdateName = DefaultStepEvents,
		H extends (ctx: StepEventCtx<E, TSceneDerives>, next: Next) => unknown = (
			ctx: StepEventCtx<E, TSceneDerives>,
			next: Next,
		) => unknown,
	>(
		handler: H,
	): StepComposerStateTracked<
		TBase,
		TSceneDerives,
		AccState & ExtractUpdateState<ReturnType<H>>
	>;
};

/** Helper: extract the accumulated state generic from a tracked step composer. */
export type ExtractStepState<T> = T extends StepComposerStateTracked<
	any,
	any,
	infer S
>
	? S
	: {};

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
