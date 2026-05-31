import type { Storage } from "@gramio/storage";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { DeriveHandler } from "@gramio/composer";
import {
	type AnyPlugin,
	type Bot,
	type Context,
	type ContextType,
	type DeriveDefinitions,
	type ErrorDefinitions,
	type EventComposer,
	type Handler,
	type MaybeArray,
	type Next,
	type Stringable,
	type UpdateName,
	compose,
	noopNext,
} from "gramio";
import { createSceneInternals, type SceneInternals } from "./scene-internals.js";
import { SceneComposerBase } from "./scene-composer.js";
import {
	StepComposer,
	type ExtractStepState,
	type StepComposerFor,
	type StepComposerInstance,
	buildStepEntry,
} from "./step-composer.js";
import { events as KNOWN_EVENTS } from "./utils.js";
import type {
	Modify,
	ScenesStorageData,
	StateTypesDefault,
	UpdateData,
} from "./types.js";
import type { getInActiveSceneHandler } from "./utils.js";

export type AnyScene = Scene<any, any, any, any>;

export type StepHandler<T, Return = any> = (context: T, next: Next) => any;

export type SceneDerivesDefinitions<
	Params,
	State extends StateTypesDefault,
	ExitData extends Record<string, unknown> = Record<string, unknown>,
> = DeriveDefinitions & {
	global: {
		scene: ReturnType<typeof getInActiveSceneHandler<Params, State, ExitData>>;
	};
};

/**
 * Scene IS an EventComposer. Inherits the full gramio DSL
 * (`.command/.callbackQuery/.hears/.on/.use/.derive/.guard/.branch/.extend/...`)
 * and adds scene-specific methods (`.params/.state/.exitData/.onEnter/.step/
 * .ask`). Scene-specific data lives on `this["~scene"]` to avoid colliding
 * with the composer's own `~` slot.
 */
export class Scene<
	Params = never,
	Errors extends ErrorDefinitions = {},
	State extends StateTypesDefault = Record<string, never>,
	Derives extends SceneDerivesDefinitions<
		Params,
		State,
		any
	> = SceneDerivesDefinitions<Params, State>,
> extends SceneComposerBase {
	name: string;
	stepsCount = 0;
	/**
	 * Override of the inherited composer's `~` slot to widen its `Out`
	 * (phantom TOut carrier) to include the scene's `Derives["global"]`.
	 * This is what makes `ctx.scene` visible inside scene-level event
	 * handlers (`scene.callbackQuery / .command / .hears / .on / …`):
	 * those methods type `ctx` via `EventContextOf<this, E>`, which reads
	 * `Out` from this slot. With the widening, `ctx.scene` is now present
	 * everywhere — both at the scene level AND inside step builders.
	 */
	declare "~": InstanceType<typeof SceneComposerBase>["~"] & {
		Out: InstanceType<typeof SceneComposerBase>["~"]["Out"] & Derives["global"];
	};
	/** @internal — scene-specific state. Stored on a dedicated slot so the
	 * composer's own `~` slot remains untouched. Generics here propagate
	 * Scene's `Params` / `State` into the structural shape so that
	 * `Scene<{id}, ...>` is distinct from `Scene<never, ...>` at the type
	 * level (needed by `SceneEnterHandler` to differentiate the no-params
	 * and with-params overloads at call sites). */
	"~scene": SceneInternals<Params, State>;

	constructor(name?: string) {
		// Pass scene name to composer for cross-bot extended-set dedup.
		super({ name });
		// For step modules (no name) we keep a synthetic empty string for the
		// public field — the `~scene.isModule` flag is the source of truth and
		// `validateScenes` rejects modules at registration time.
		this.name = name ?? "";
		this["~scene"] = createSceneInternals(name) as SceneInternals<
			Params,
			State
		>;
	}

	// ─── Type-only chain methods (params / state / exitData) ───

	params<SceneParams>() {
		return this as unknown as Scene<
			SceneParams,
			Errors,
			State,
			Modify<
				Derives,
				{
					global: {
						scene: Modify<
							Derives["global"]["scene"],
							{
								params: SceneParams;
								reenter: (params?: SceneParams) => Promise<void>;
							}
						>;
					};
				}
			>
		>;
	}

	state<StateParams extends StateTypesDefault>() {
		return this as unknown as Scene<
			Params,
			Errors,
			StateParams,
			Modify<
				Derives,
				{
					global: Modify<
						Derives["global"],
						{
							scene: Modify<
								Derives["global"]["scene"],
								{ state: StateParams }
							>;
						}
					>;
				}
			>
		>;
	}

	exitData<ExitData extends Record<string, unknown>>() {
		return this as unknown as Scene<
			Params,
			Errors,
			State,
			Modify<
				Derives,
				{
					global: Modify<
						Derives["global"],
						{
							scene: Modify<
								Derives["global"]["scene"],
								{
									exitSub: (returnData?: ExitData) => Promise<void>;
								}
							>;
						}
					>;
				}
			>
		>;
	}

	// ─── extend (overrides parent to re-type as Scene) ───

	/** Merge another Scene's middlewares + lifecycle hooks + step list. */
	extend<
		UParams,
		UErrors extends ErrorDefinitions,
		UState extends StateTypesDefault,
		UDerives extends SceneDerivesDefinitions<UParams, UState, any>,
	>(
		scene: Scene<UParams, UErrors, UState, UDerives>,
	): Scene<
		Params,
		Errors & UErrors,
		Record<string, never> extends State
			? UState
			: Record<string, never> extends UState
				? State
				: State & UState,
		Derives & UDerives
	>;

	extend<UExposed extends object, UDerives extends Record<string, object>>(
		composer: EventComposer<any, any, any, any, UExposed, UDerives, any>,
	): Scene<
		Params,
		Errors,
		State,
		Derives & { global: UExposed } & UDerives
	>;

	extend<NewPlugin extends AnyPlugin>(
		plugin: NewPlugin,
	): Scene<
		Params,
		Errors & NewPlugin["_"]["Errors"],
		State,
		// @ts-expect-error
		Derives & NewPlugin["_"]["Derives"]
	>;

	extend(other: any): this {
		// Detect: is this another Scene? Look for the dedicated `~scene` slot
		// (set in our constructor; not present on plain Plugin / Composer).
		const isScene =
			other != null &&
			typeof other === "object" &&
			"~scene" in other &&
			other["~scene"] != null;

		// Always delegate to the inherited composer.extend() first — this merges
		// middlewares, derives, macros, errors, and tracked plugins.
		(super.extend as (arg: unknown) => unknown)(other);

		if (!isScene) return this;

		// Scene-specific merge: builder steps + lifecycle hooks.
		const otherInternals = (other as Scene<any, any, any, any>)["~scene"];

		for (const entry of otherInternals.steps) {
			let newId: string | number;
			if (typeof entry.id === "number") {
				// Renumber to keep numeric ids unique across the merged scene.
				newId = this.stepsCount++;
			} else {
				// Named ids must not collide.
				for (const existing of this["~scene"].steps) {
					if (existing.id === entry.id) {
						throw new Error(
							`scene.extend: step "${entry.id}" already exists in scene "${this.name || "<module>"}"`,
						);
					}
				}
				newId = entry.id;
			}
			this["~scene"].steps.push({ ...entry, id: newId });
		}

		// onEnter / onExit: A wins; copy B's only if A has none.
		if (!this["~scene"].enter && otherInternals.enter) {
			this["~scene"].enter = otherInternals.enter;
		}
		if (!this["~scene"].exit && otherInternals.exit) {
			this["~scene"].exit = otherInternals.exit;
		}

		return this;
	}

	// ─── Composer-level overrides to preserve Scene<...> in the chain ──
	//
	// The base `EventComposer.derive(handler)` returns a widened EventComposer
	// (it changes the TOut generic), which strips the `Scene<...>` subclass
	// type — so chained `.onEnter / .step / .ask / .params` calls afterwards
	// stop type-checking. We override here to:
	//   1) delegate to `super.derive` for the runtime middleware,
	//   2) re-type the return as `Scene<...>` with the new Derives mixed into
	//      the scene's `Derives` slot (so step ctx can pick them up later).
	//
	// `.use / .guard / .command / .callbackQuery / .hears / ...` all already
	// return `this` upstream so we don't need to override them — only the
	// generic-widening methods (`derive`, `decorate`) need this treatment.

	derive<D extends object>(
		handler: DeriveHandler<ContextType<Bot, "message"> & Derives["global"], D>,
	): Scene<
		Params,
		Errors,
		State,
		Modify<
			Derives,
			{
				global: Derives["global"] & D;
			}
		>
	>;

	derive<D extends object>(
		handler: DeriveHandler<ContextType<Bot, "message"> & Derives["global"], D>,
		options: { as: "scoped" | "global" },
	): Scene<
		Params,
		Errors,
		State,
		Modify<
			Derives,
			{
				global: Derives["global"] & D;
			}
		>
	>;

	derive<E extends UpdateName, D extends object>(
		event: MaybeArray<E>,
		handler: DeriveHandler<ContextType<Bot, E> & Derives["global"], D>,
	): Scene<Params, Errors, State, Derives & { [K in E]: D }>;

	derive(...args: any[]): any {
		(super.derive as (...a: any[]) => unknown)(...args);
		return this;
	}

	/**
	 * Override of `.decorate` that preserves Scene<...>. Same reason as
	 * `.derive` above — the base method widens TOut and drops the subclass.
	 */
	decorate<D extends object>(
		values: D,
	): Scene<
		Params,
		Errors,
		State,
		Modify<Derives, { global: Derives["global"] & D }>
	>;

	decorate<D extends object>(
		values: D,
		options: { as: "scoped" | "global" },
	): Scene<
		Params,
		Errors,
		State,
		Modify<Derives, { global: Derives["global"] & D }>
	>;

	decorate(...args: any[]): any {
		(super.decorate as (...a: any[]) => unknown)(...args);
		return this;
	}

	// Scene-level event handlers (.on/.command/.callbackQuery/.hears/.use)
	// inherit their typing from `SceneComposerBase`. The `~` slot widening
	// above (Out & Derives["global"]) threads `ctx.scene` (and any
	// scene-level `.derive(...)` fields) into every inherited handler's
	// ctx, so they type-check the same way step handlers do.

	// ─── Lifecycle ───

	/**
	 * Register a handler that runs once when the user enters the scene.
	 *
	 * Fires AFTER scene-level `.derive()` / `.decorate()` middleware has
	 * applied — so derived ctx fields (`ctx.user`, etc.) ARE available. Fires
	 * exactly once per scene occupancy: `step.go(...)` transitions don't
	 * re-trigger it.
	 *
	 * @example
	 * new Scene("checkout")
	 *   .derive(async ctx => ({ user: await db.users.find(ctx.from!.id) }))
	 *   .onEnter(ctx => analytics.track("checkout_start", { userId: ctx.user.id }))
	 *   .step("review", c => c.message("Order looks good?").on("message", ...))
	 */
	onEnter(
		handler: (context: ContextType<Bot, "message"> & Derives["global"]) => unknown,
	) {
		this["~scene"].enter = handler as (ctx: any) => unknown;
		return this;
	}

	/**
	 * Register a handler that runs when the user leaves this scene — on
	 * `ctx.scene.exit()`, `ctx.scene.exitSub()` (the sub-scene exits), and
	 * `ctx.scene.reenter()` (the prior occupancy of this scene ends before
	 * re-entry). Symmetric to `.onEnter`. Useful for cleanup, analytics,
	 * "thanks for completing" messages.
	 */
	onExit(
		handler: (context: ContextType<Bot, "message"> & Derives["global"]) => unknown,
	) {
		this["~scene"].exit = handler as (ctx: any) => unknown;
		return this;
	}

	// ─── Step API ───
	//
	// Three forms:
	//   1. Builder, numeric:  scene.step(c => c.enter(...).on("message", ...))
	//   2. Builder, named:    scene.step("intro", c => c.enter(...).on("message", ...))
	//   3. Legacy:            scene.step("message", (ctx, next) => ...) — preserved
	//                          scene.step(["message", "callback_query"], handler)
	//
	// Disambiguation: first arg in `KNOWN_EVENTS` (or array) → legacy event-filter.
	// Otherwise the first string is treated as a step name (builder form).

	/**
	 * Builder, numeric step id (autoincrement).
	 *
	 * The builder's return type is inspected for any `Awaited<ReturnType<H>>`
	 * that contains `UpdateData<T>` — i.e., any handler returning
	 * `ctx.scene.update({…})`. Those T's are merged into Scene's `State`
	 * generic automatically, so subsequent steps see `ctx.scene.state.X`
	 * properly typed without any `.state<T>()` annotation.
	 */
	// @ts-expect-error overload narrows return type beyond impl
	step<
		B extends (c: StepComposerFor<Derives>) => unknown,
		StepState extends object = ExtractStepState<ReturnType<B>>,
	>(
		builder: B,
	): Scene<
		Params,
		Errors,
		Record<string, never> extends State ? StepState : State & StepState,
		Modify<
			Derives,
			{
				global: Modify<
					Derives["global"],
					{
						scene: Modify<
							Derives["global"]["scene"],
							{
								state: Record<string, never> extends State
									? StepState
									: State & StepState;
							}
						>;
					}
				>;
			}
		>
	>;

	/**
	 * Legacy event-filtered step (single event name OR an array of events).
	 *
	 * Listed BEFORE the named-builder overload so TS's overload resolution
	 * tries this first. `T extends UpdateName` then either succeeds (real
	 * event name like `"message"`) and types `ctx` properly, OR fails so TS
	 * falls through to the named-builder overload. Result: `step("message",
	 * (ctx, next) => …)` types `ctx` as `MessageContext`, while
	 * `step("intro", (c) => …)` (with a name that's NOT a known event)
	 * cleanly resolves to the named-builder overload.
	 */
	step<
		T extends UpdateName,
		Handler extends StepHandler<
			ContextType<Bot, T> & Derives["global"] & Derives[T],
			any
		>,
		Return = Awaited<ReturnType<Handler>>,
	>(
		updateName: MaybeArray<T>,
		handler: Handler,
	): Scene<
		Params,
		Errors,
		Extract<Return, UpdateData<any>> extends UpdateData<infer Type>
			? Record<string, never> extends State
				? Type
				: State & Type
			: State,
		Modify<
			Derives,
			{
				global: Modify<
					Derives["global"],
					{
						scene: Modify<
							Derives["global"]["scene"],
							{
								state: Extract<Return, UpdateData<any>> extends UpdateData<
									infer Type
								>
									? Record<string, never> extends State
										? Type
										: State & Type
									: State;
							}
						>;
					}
				>;
			}
		>
	>;

	/**
	 * Builder, named step id. Same state-inference behavior as the numeric
	 * form — any `update({…})` calls inside handlers widen `State`.
	 */
	step<
		B extends (c: StepComposerFor<Derives>) => unknown,
		StepState extends object = ExtractStepState<ReturnType<B>>,
	>(
		name: string,
		builder: B,
	): Scene<
		Params,
		Errors,
		Record<string, never> extends State ? StepState : State & StepState,
		Modify<
			Derives,
			{
				global: Modify<
					Derives["global"],
					{
						scene: Modify<
							Derives["global"]["scene"],
							{
								state: Record<string, never> extends State
									? StepState
									: State & StepState;
							}
						>;
					}
				>;
			}
		>
	>;

	step(...args: any[]): this {
		// 1-arg form: builder function (numeric id)
		if (args.length === 1) {
			const [arg] = args;
			if (typeof arg === "function") {
				return this._registerBuilderStep(this.stepsCount++, arg);
			}
			throw new Error(
				"scene.step() with one argument requires a builder function: scene.step(c => c.enter(...))",
			);
		}

		// 2-arg form: legacy event-filter or named builder
		if (args.length === 2) {
			const [first, second] = args;
			if (typeof second !== "function")
				throw new Error("scene.step() second argument must be a function");

			// Array first arg → legacy event-filter
			if (Array.isArray(first)) {
				return this._registerLegacyEventStep(
					this.stepsCount++,
					first,
					second,
				);
			}

			if (typeof first === "string") {
				// Reserved event name → legacy event-filter (back-compat).
				// At type level the overload reorder + `T extends UpdateName`
				// catches builder-with-reserved-name mistakes; at runtime we
				// just route the call to the legacy handler so existing code
				// (`step("message", ctx => …)`) keeps working.
				if ((KNOWN_EVENTS as readonly string[]).includes(first)) {
					return this._registerLegacyEventStep(
						this.stepsCount++,
						first as UpdateName,
						second,
					);
				}
				// Otherwise treat string as a step NAME (builder form).
				return this._registerBuilderStep(first, second);
			}
		}

		throw new Error(
			"Invalid scene.step() arguments — expected (builder), (name, builder), or (event(s), handler)",
		);
	}

	/** @internal Register a builder-style step: creates a fresh StepComposer,
	 * runs the user's builder against it, and stores the entry on `~scene.steps`. */
	private _registerBuilderStep(
		id: string | number,
		builder: (c: StepComposerInstance) => StepComposerInstance | void,
	): this {
		// Named-step collision check (for explicit string ids)
		if (typeof id === "string") {
			for (const existing of this["~scene"].steps) {
				if (existing.id === id) {
					throw new Error(
						`scene.step("${id}", ...): a step with id "${id}" already exists in scene "${this.name}"`,
					);
				}
			}
		}

		const stepComposer = new StepComposer() as StepComposerInstance;
		builder(stepComposer);
		this["~scene"].steps.push(buildStepEntry(id, stepComposer));
		return this;
	}

	/** @internal Register a legacy event-filtered step as a gated `.use()`
	 * middleware. Preserved for back-compat with the original `.step("message", ctx => ...)` API. */
	private _registerLegacyEventStep(
		stepId: string | number,
		updateName: MaybeArray<UpdateName>,
		handler: (ctx: any, next: any) => unknown,
	): this {
		this.use(async (context: any, next: any) => {
			if (context.scene?.step?.id === stepId) {
				if (context.is(updateName)) return handler(context, next);
				return next();
			}
			return next();
		});
		return this;
	}

	ask<
		Key extends string,
		Schema extends StandardSchemaV1,
		Return extends StateTypesDefault = {
			[key in Key]: StandardSchemaV1.InferOutput<Schema>;
		},
	>(
		key: Key,
		validator: Schema,
		firstTimeMessage: Stringable,
		options?: {
			/** Custom message when validation fails. Receives all issues from the validator. */
			onInvalidInput?: (
				issues: readonly StandardSchemaV1.Issue[],
			) => Stringable;
		},
	): Scene<
		Params,
		Errors,
		Record<string, never> extends State ? Return : State & Return,
		Modify<
			Derives,
			{
				global: Modify<
					Derives["global"],
					{
						scene: Modify<
							Derives["global"]["scene"],
							{
								state: Record<string, never> extends State
									? Return
									: State & Return;
							}
						>;
					}
				>;
			}
		>
	> {
		// Implementation note: kept as a legacy numeric step for now. Migrating
		// `.ask` to a named-step builder (with `key` as the step id) would let
		// `scene.step.go("email")` jump back to the ask, but it breaks when
		// chained with legacy `.step("message", ...)` calls — the transition out
		// of a named ask step doesn't auto-advance to a sibling numeric legacy
		// step, since the two systems track step ordering separately. Will land
		// once builder/legacy mixing has unified semantics (v0.7.x).
		return this.step(["callback_query", "message"], async (context, next) => {
			if (context.scene.step.firstTime) return context.send(firstTimeMessage);

			let result = validator["~standard"].validate(
				context.is("message") ? context.text : context.data,
			);
			if (result instanceof Promise) result = await result;

			if (result.issues)
				return context.send(
					options?.onInvalidInput
						? options.onInvalidInput(result.issues)
						: result.issues[0]!.message,
				);

			return context.scene.update({
				[key]: result.value,
			});
		}) as any;
	}

	// ─── Runtime entry points (called by scenes/src/index.ts and utils.ts) ───
	//
	// Named distinctly from the inherited Composer.compose()/run() to avoid
	// signature collision. The composer DSL (`scene.run(ctx, next?)` would
	// invoke the middleware runner) remains untouched on the inherited
	// methods; scenes-specific dispatch goes through these.

	async dispatch(
		context: Context<Bot> & {
			[key: string]: unknown;
		},
		onNext?: () => unknown,
		passthrough?: Next,
		/**
		 * Middleware fns that have already run for this update (e.g. derive/
		 * decorate pre-run so `onEnter` could see them in the legacy path) and
		 * must NOT run again here. They `Object.assign` onto the live ctx, so
		 * their effect persists — re-running would only re-fire side effects and
		 * double-count. Filtering by fn identity skips exactly those.
		 */
		skipFns?: ReadonlySet<unknown>,
	) {
		let fellThrough = false;
		const terminal: Next = passthrough
			? async () => {
					fellThrough = true;
					return passthrough();
				}
			: noopNext;

		// Cross-chain dedup: if a named Composer/Plugin was already applied in the
		// bot's main chain (bot.extend(withUser)), skip it here so it doesn't run
		// twice. The bot's extended-set is keyed as "<name>:<seed>" (e.g.
		// "withUser:null"), and each middleware carries the plugin name it came from.
		const botExtended = context.bot?.updates?.composer?.["~"]?.extended;

		if (botExtended?.size || skipFns?.size) {
			const fns = this._dedupeAgainstBot(this["~"].middlewares, botExtended)
				.filter((m) => !skipFns?.has(m.fn))
				.map((m) => m.fn);
			await compose(fns)(context, terminal);
		} else {
			await super.run(context as any, terminal);
		}

		if (!fellThrough) onNext?.();
	}

	/**
	 * @internal Drop middlewares whose `plugin` is already in the bot's
	 * extended-set (`bot.extend(withUser)`) so a named plugin/composer shared
	 * between the bot chain and a scene runs once per update, not twice. Used by
	 * `dispatch` and by the onEnter setup pre-runs in `dispatchActive`.
	 */
	private _dedupeAgainstBot<T extends { plugin?: string }>(
		mws: T[],
		botExtended: ReadonlySet<string> | undefined,
	): T[] {
		if (!botExtended?.size) return mws;
		return mws.filter((m) => {
			if (!m.plugin) return true;
			for (const key of botExtended) {
				if (key.startsWith(`${m.plugin}:`)) return false;
			}
			return true;
		});
	}

	async dispatchActive(
		context: Context<Bot> & {
			[key: string]: unknown;
		},
		storage: Storage,
		key: string,
		data: ScenesStorageData<unknown, unknown>,
		passthrough?: Next,
	) {
		const sceneSteps = this["~scene"].steps;
		const stepEntry = sceneSteps.find((s) => s.id === data.stepId);

		// Builder step on first entry: apply derives/decorates/guards so ctx is
		// populated and access checks fire, fire scene.onEnter on the very
		// first scene-entry (not on subsequent step.go() transitions), then
		// run step's message + enter, mark firstTime=false, done.
		if (stepEntry && data.firstTime) {
			// Apply ctx-mutating + access-checking middleware (derive/decorate/
			// guard) from both the scene-level chain and the step's own chain.
			// We deliberately skip regular handlers (.use/.on/.command/...) on
			// first entry — they'd match the entry update (e.g. /start) and
			// produce double-fires.
			const stepComposer = stepEntry.composer as StepComposerInstance;
			// Run setup middleware on first entry: derive/decorate (ctx mutators)
			// + guard (access checks). A failing guard calls its fail middleware
			// (or just stops in gate mode) and does NOT call next() — proceed
			// stays false, and we skip message/enter so the scene doesn't fully
			// open. Regular handlers (.use/.on/.command/...) are deliberately
			// skipped on first entry so they don't double-fire on the trigger
			// update (e.g. /start).
			const setupTypes = new Set(["derive", "decorate", "guard"]);
			// Scene-level setup honors cross-bot dedup: a derive already run by
			// the bot's main chain (bot.extend(withUser)) is skipped here — its
			// fields are already on ctx via Object.assign, so onEnter still sees
			// them, and it isn't fired a second time. Step-local middleware is
			// never bot-extended, so it needs no dedup.
			const botExtended = context.bot?.updates?.composer?.["~"]?.extended;
			const setupFns = [
				...this._dedupeAgainstBot(
					this["~"].middlewares.filter((m) => setupTypes.has(m.type)),
					botExtended,
				).map((m) => m.fn),
				...stepComposer["~"].middlewares
					.filter((m) => setupTypes.has(m.type))
					.map((m) => m.fn),
			];
			let proceed = setupFns.length === 0;
			if (setupFns.length) {
				await compose(setupFns)(context, async () => {
					proceed = true;
				});
			}
			if (!proceed) {
				// A guard (or other setup middleware) stopped the chain — don't
				// run message/enter, don't flip firstTime. The user is not yet
				// in the step, semantically.
				return;
			}

			// Fire scene-level onEnter exactly once per scene occupancy. The
			// `entered` flag prevents re-fire on step.go(...) transitions where
			// firstTime is also true.
			if (!data.entered && this["~scene"].enter) {
				await this["~scene"].enter(context);
			}

			if (stepEntry.message !== undefined) {
				const text =
					typeof stepEntry.message === "function"
						? await stepEntry.message(context)
						: stepEntry.message;
				await (context as any).send(text);
			}
			if (stepEntry.enter) {
				await stepEntry.enter(context, noopNext);
			}
			await storage.set(key, { ...data, firstTime: false, entered: true });
			return;
		}

		// No builder step at this id → legacy mode: run the whole scene composer.
		// (Legacy steps register themselves as gated `.use()` middleware on `this`.)
		//
		// For onEnter to see scene-level derives, we'd need to run derives FIRST
		// then call onEnter. But the legacy chain interleaves derives + handlers
		// in registration order, so we can't isolate "just the derives" without
		// running handlers too. As a compromise, fire onEnter inside the
		// dispatch chain via a short-circuit wrapper that runs derive/decorate
		// middleware first, then onEnter, then resumes the rest of the chain.
		if (!stepEntry) {
			const fireOnEnter = !data.entered && this["~scene"].enter;

			// fns pre-run for onEnter, skipped in the dispatch chain below so a
			// scene-level derive consumed by onEnter runs exactly once on the
			// entry update (it Object.assigns onto the live ctx, so its effect
			// persists into the dispatch chain without re-running).
			let preRunFns: Set<unknown> | undefined;
			if (fireOnEnter) {
				const setupTypes = new Set(["derive", "decorate"]);
				const botExtended =
					context.bot?.updates?.composer?.["~"]?.extended;
				const setupFns = this._dedupeAgainstBot(
					this["~"].middlewares.filter((m) => setupTypes.has(m.type)),
					botExtended,
				).map((m) => m.fn);
				if (setupFns.length) {
					preRunFns = new Set(setupFns);
					await compose(setupFns)(context, noopNext);
				}
				await this["~scene"].enter!(context);
			}

			return this.dispatch(
				context,
				async () => {
					if (data.firstTime) {
						await storage.set(key, {
							...data,
							firstTime: false,
							entered: true,
						});
					}
				},
				passthrough,
				preRunFns,
			);
		}

		// Builder step, subsequent update: scene-level chain → step composer chain.
		let fellThrough = false;
		const terminal: Next = passthrough
			? async () => {
					fellThrough = true;
					return passthrough();
				}
			: noopNext;

		// Cross-bot dedup on the scene-level chain (same logic as dispatch()).
		const botExtended = context.bot?.updates?.composer?.["~"]?.extended;
		const sceneFns = this._dedupeAgainstBot(
			this["~"].middlewares,
			botExtended,
		).map((m) => m.fn);

		const stepComposer = stepEntry.composer as StepComposerInstance;
		const stepFns = stepComposer["~"].middlewares.map((m) => m.fn);

		// Combined chain: scene middleware → wrapper that runs the step's own
		// middleware then routes the result.
		//
		// Routing rules when the step chain falls through (no handler claimed
		// the update):
		//   • step has .fallback → invoke it; do NOT propagate further
		//   • no .fallback        → call `next()` (terminal / outer-bot chain)
		// When the step chain takes ownership (a handler matched), do nothing.
		const combined = [
			...sceneFns,
			async (c: any, next: Next) => {
				let chainFellThrough = false;
				await compose(stepFns)(c, async () => {
					chainFellThrough = true;
				});

				if (!chainFellThrough) return; // step handler took ownership

				if (stepEntry.fallback) {
					await stepEntry.fallback(c, noopNext);
					return; // fallback consumed the update
				}

				return next(); // propagate to terminal / outer chain
			},
		];

		await compose(combined)(context, terminal);
	}
}
