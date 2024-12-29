import type { Storage } from "@gramio/storage";
import type {
	AnyPlugin,
	Bot,
	Context,
	ContextType,
	DeriveDefinitions,
	ErrorDefinitions,
	Handler,
	MaybeArray,
	MaybePromise,
	UpdateName,
} from "gramio";
import { Composer } from "gramio";
import { type NextMiddleware, noopNext } from "middleware-io";
import type {
	Modify,
	ScenesStorageData,
	StateTypesDefault,
	UpdateData,
} from "./types.js";
import type { getInActiveSceneHandler } from "./utils.js";

export type AnyScene = Scene<any, any, any, any>;

export type StepHandler<T, Return = any> = (
	context: T,
	next: NextMiddleware,
) => any;

export type SceneDerivesDefinitions<
	Params,
	State extends StateTypesDefault,
> = DeriveDefinitions & {
	global: {
		scene: ReturnType<typeof getInActiveSceneHandler<Params, State>>;
	};
};

type ExtractUpdateData<T> = T extends UpdateData<infer U>
	? UpdateData<U>
	: never;

export class Scene<
	Params = never,
	Errors extends ErrorDefinitions = {},
	State extends StateTypesDefault = Record<string, never>,
	Derives extends SceneDerivesDefinitions<
		Params,
		State
	> = SceneDerivesDefinitions<Params, State>,
> {
	/** @internal */
	"~" = {
		params: {} as Params,
		state: {} as State,
		composer: new Composer(),
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

	/**
	 * ! ** At the moment, it can only pick up types** */
	extend<NewPlugin extends AnyPlugin>(
		plugin: MaybePromise<NewPlugin>,
	): Scene<
		Params,
		Errors & NewPlugin["_"]["Errors"],
		State,
		// @ts-expect-error
		Derives & NewPlugin["_"]["Derives"]
	> {
		return this;
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

	async compose(
		context: Context<Bot> & {
			[key: string]: unknown;
		},
		onNext?: () => unknown,
	) {
		await this["~"].composer.composed(context, noopNext);
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

			if (data.firstTime) await storage.set(key, { ...data, firstTime: false });
		});
	}
}
