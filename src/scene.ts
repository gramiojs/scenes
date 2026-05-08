import type { Storage } from "@gramio/storage";
import type { StandardSchemaV1 } from "@standard-schema/spec";
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
	/** @internal — scene-specific state. Stored on a dedicated slot so the
	 * composer's own `~` slot remains untouched. */
	"~scene": SceneInternals;

	constructor(name: string) {
		// Pass scene name to composer for cross-bot extended-set dedup.
		super({ name });
		this.name = name;
		this["~scene"] = createSceneInternals(name);
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
			Derives & {
				global: {
					scene: Modify<
						Derives["global"]["scene"],
						{
							state: StateParams;
						}
					>;
				};
			}
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

	extend(
		pluginOrComposer:
			| AnyPlugin
			| EventComposer<any, any, any, any, any, any, any>,
	): this {
		// Delegate to the inherited composer.extend(); cross-bot dedup is
		// handled internally via this["~"].extended.
		(super.extend as (arg: unknown) => unknown)(pluginOrComposer);
		return this;
	}

	// ─── Lifecycle ───

	onEnter(
		handler: (context: ContextType<Bot, "message"> & Derives["global"]) => unknown,
	) {
		this["~scene"].enter = handler as (ctx: any) => unknown;
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

	/** Builder, numeric step id (autoincrement) */
	step(
		builder: (c: StepComposerInstance) => StepComposerInstance | void,
	): this;

	/** Builder, named step id */
	step(
		name: string,
		builder: (c: StepComposerInstance) => StepComposerInstance | void,
	): this;

	/** Legacy event-filtered step */
	// @ts-expect-error overload signature
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
				// Reserved event name → legacy event-filter (back-compat)
				if ((KNOWN_EVENTS as readonly string[]).includes(first)) {
					return this._registerLegacyEventStep(
						this.stepsCount++,
						first as UpdateName,
						second,
					);
				}
				// Otherwise treat string as a step NAME (builder form)
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

		if (botExtended?.size) {
			const fns = this["~"].middlewares
				.filter((m) => {
					if (!m.plugin) return true;
					for (const key of botExtended) {
						if (key.startsWith(`${m.plugin}:`)) return false;
					}
					return true;
				})
				.map((m) => m.fn);
			await compose(fns)(context, terminal);
		} else {
			await super.run(context as any, terminal);
		}

		if (!fellThrough) onNext?.();
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

		// Builder step on first entry: run message + enter, mark firstTime=false, done.
		if (stepEntry && data.firstTime) {
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
			await storage.set(key, { ...data, firstTime: false });
			return;
		}

		// No builder step at this id → legacy mode: run the whole scene composer.
		// (Legacy steps register themselves as gated `.use()` middleware on `this`.)
		if (!stepEntry) {
			return this.dispatch(
				context,
				async () => {
					if (data.firstTime) {
						await storage.set(key, { ...data, firstTime: false });
					}
				},
				passthrough,
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
		const sceneFns =
			botExtended?.size
				? this["~"].middlewares
						.filter((m) => {
							if (!m.plugin) return true;
							for (const k of botExtended) {
								if (k.startsWith(`${m.plugin}:`)) return false;
							}
							return true;
						})
						.map((m) => m.fn)
				: this["~"].middlewares.map((m) => m.fn);

		const stepComposer = stepEntry.composer as StepComposerInstance;
		const stepFns = stepComposer["~"].middlewares.map((m) => m.fn);

		let stepHandled = false;

		// Combined chain: scene middleware → wrapper that runs step middleware.
		const combined = [
			...sceneFns,
			async (c: any, next: Next) => {
				await compose(stepFns)(c, async () => {
					stepHandled = true;
				});
				return next();
			},
		];

		await compose(combined)(context, terminal);

		if (!stepHandled && stepEntry.fallback && !fellThrough) {
			await stepEntry.fallback(context, noopNext);
		}
	}
}
