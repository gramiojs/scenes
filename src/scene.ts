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
import { Composer } from "gramio/dist/composer";
import { noopNext } from "middleware-io";
import type { getInActiveSceneHandler } from "./utils";

export type AnyScene = Scene<any, any, any>;

export class Scene<
	Params = never,
	Errors extends ErrorDefinitions = {},
	Derives extends DeriveDefinitions = DeriveDefinitions & {
		global: {
			scene: ReturnType<typeof getInActiveSceneHandler>;
		};
	},
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
			Derives & {
				global: {
					scene: Derives["global"] extends { scene: any }
						? Omit<Derives["global"]["scene"], "params"> & {
								params: SceneParams;
							}
						: {};
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

	step<T extends UpdateName>(
		updateName: MaybeArray<T>,
		handler: Handler<ContextType<Bot, T> & Derives["global"] & Derives[T]>,
	): this;
	step(handler: Handler<Context<Bot> & Derives["global"]>): this;
	step<T extends UpdateName>(
		updateName: MaybeArray<T> | Handler<Context<Bot> & Derives["global"]>,
		handler?: Handler<Context<Bot> & Derives["global"]>,
	) {
		const stepId = this.stepsCount++;
		console.log(stepId);
		if (Array.isArray(updateName) || typeof updateName === "string") {
			if (!handler)
				throw new Error("You must specify handler as the second argument");

			return this.use(async (context, next) => {
				// @ts-expect-error
				if (context.is(updateName) && context.scene.step.id === stepId)
					return handler(context, next);
				// @ts-expect-error
				if (context.scene.step.id > stepId) return await next();
			});
		}

		return this.use(async (context, next) => {
			// @ts-expect-error
			if (context.scene.step.id === stepId) return updateName(context, next);
			// @ts-expect-error
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
