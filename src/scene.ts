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
import type { Modify, StateTypesDefault, UpdateData } from "./types.js";
import type { getInActiveSceneHandler } from "./utils.js";

export type AnyScene = Scene<any, any, any, any>;

export type StepHandler<T, Return> = (
	context: T,
	next: NextMiddleware,
) => MaybePromise<Return>;

export type SceneDerivesDefinitions<
	Params,
	State extends StateTypesDefault,
> = DeriveDefinitions & {
	global: {
		scene: ReturnType<typeof getInActiveSceneHandler<Params, State>>;
	};
};

export class Scene<
	Params = never,
	Errors extends ErrorDefinitions = {},
	State extends StateTypesDefault = {},
	Derives extends SceneDerivesDefinitions<
		Params,
		State
	> = SceneDerivesDefinitions<Params, State>,
> {
	/** @internal */
	_ = {
		params: {} as Params,
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
			Derives & {
				global: {
					scene: Modify<
						Derives["global"]["scene"],
						{
							params: SceneParams;
						}
					>;
				};
			}
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
		this._.composer.on(updateName, handler);

		return this;
	}

	use(handler: Handler<Context<Bot> & Derives["global"]>) {
		this._.composer.use(handler);

		return this;
	}

	// @ts-expect-error
	step<T extends UpdateName, Return>(
		updateName: MaybeArray<T>,
		handler: StepHandler<
			ContextType<Bot, T> & Derives["global"] & Derives[T],
			Return
		>,
	): Scene<
		Params,
		Errors,
		Return extends UpdateData<infer Type> ? State & Type : State,
		Derives & {
			global: {
				scene: Modify<
					Derives["global"]["scene"],
					{
						state: Return extends UpdateData<infer Type> ? State & Type : State;
					}
				>;
			};
		}
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
		await this._.composer.composed(context, noopNext);
		onNext?.();
	}
}
