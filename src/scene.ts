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

	// ─── Step API (legacy overloads only — builder API lands in step 6) ───

	// @ts-expect-error
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
	step(handler: Handler<Context<Bot> & Derives["global"]>): this;
	step<T extends UpdateName>(
		updateName: MaybeArray<T> | Handler<Context<Bot> & Derives["global"]>,
		handler?: Handler<Context<Bot> & Derives["global"]>,
	) {
		const stepId = this.stepsCount++;
		if (Array.isArray(updateName) || typeof updateName === "string") {
			if (!handler)
				throw new Error("You must specify handler as the second argument");

			return this.use(async (context: any, next: any) => {
				if (context.scene.step.id === stepId) {
					if (context.is(updateName)) return handler(context, next);
					return next();
				}
				return next();
			});
		}

		return this.use(async (context: any, next: any) => {
			if (context.scene.step.id === stepId) return updateName(context, next);
			return next();
		});
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
}
