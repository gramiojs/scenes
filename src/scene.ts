import type { Storage } from "@gramio/storage";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
	type AnyPlugin,
	type Bot,
	Composer,
	type Context,
	type ContextType,
	type DeriveDefinitions,
	type ErrorDefinitions,
	type EventComposer,
	type Handler,
	type MaybeArray,
	type MaybePromise,
	type Next,
	type Stringable,
	type UpdateName,
	compose,
	noopNext,
} from "gramio";
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

export class Scene<
	Params = never,
	Errors extends ErrorDefinitions = {},
	State extends StateTypesDefault = Record<string, never>,
	Derives extends SceneDerivesDefinitions<
		Params,
		State,
		any
	> = SceneDerivesDefinitions<Params, State>,
> {
	/** @internal */
	"~" = {
		params: {} as Params,
		state: {} as State,
		composer: new Composer(),
		
		enter: (ctx: ContextType<Bot, 'message'> & Derives["global"]) => {}
	};

	name: string;
	stepsCount = 0;

	constructor(name: string) {
		this.name = name;
	}

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
		if (
			"compose" in pluginOrComposer &&
			"run" in pluginOrComposer &&
			!("_" in pluginOrComposer)
		) {
			// EventComposer: deduplication is handled internally via composer["~"].extended
			this["~"].composer.extend(pluginOrComposer as any);
		} else {
			// AnyPlugin: Plugin exposes get "~"() that duck-types as Composer
			this["~"].composer.extend(pluginOrComposer as any);
		}

		return this;
	}
	
	onEnter(
	    handler: (context: ContextType<Bot, 'message'> & Derives["global"]) => unknown,
	) {
	    this['~'].enter = handler

		return this
	}

	on<T extends UpdateName>(
		updateName: MaybeArray<T>,
		handler: Handler<ContextType<Bot, T> & Derives["global"] & Derives[T]>,
	) {
		this["~"].composer.on(updateName, handler);

		return this;
	}

	use(handler: Handler<Context<Bot> & Derives["global"]>) {
		this["~"].composer.use(handler);

		return this;
	}

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

			return this.use(async (context, next) => {
				if (context.is(updateName) && context.scene.step.id === stepId)
					return handler(context, next);

				if (context.scene.step.id > stepId) return await next();
			});
		}

		return this.use(async (context, next) => {
			if (context.scene.step.id === stepId) return updateName(context, next);
			if (context.scene.step.id > stepId) return await next();
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
		// Types so hard for typescript
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

	async compose(
		context: Context<Bot> & {
			[key: string]: unknown;
		},
		onNext?: () => unknown,
	) {
		// Cross-chain dedup: if a named Composer/Plugin was already applied in the
		// bot's main chain (bot.extend(withUser)), skip it here so it doesn't run
		// twice. The bot's extended-set is keyed as "<name>:<seed>" (e.g.
		// "withUser:null"), and each middleware carries the plugin name it came from.
		const botExtended = context.bot?.updates?.composer?.["~"]?.extended;

		if (botExtended?.size) {
			const fns = this["~"].composer["~"].middlewares
				.filter((m) => {
					if (!m.plugin) return true;
					for (const key of botExtended) {
						if (key.startsWith(`${m.plugin}:`)) return false;
					}
					return true;
				})
				.map((m) => m.fn);
			await compose(fns)(context, noopNext);
		} else {
			await this["~"].composer.run(context, noopNext);
		}

		onNext?.();
	}

	async run(
		context: Context<Bot> & {
			[key: string]: unknown;
		},
		storage: Storage,
		key: string,
		data: ScenesStorageData<unknown, unknown>,
	) {
		return this.compose(context, async () => {
			// TODO: We should know is state edited or not?
			
			if (data.firstTime) {
			    await storage.set(key, { ...data, firstTime: false });
			}
		});
	}
}
