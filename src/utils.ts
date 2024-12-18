import type { Storage } from "@gramio/storage";
import type { Bot, ContextType } from "gramio";
import type { AnyScene } from "./scene.js";
import type {
	SceneUpdateState,
	ScenesStorageData,
	StateTypesDefault,
	UpdateData,
} from "./types.js";

export function getSceneHandlers(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
) {
	const key = `@gramio/scenes:${context.from?.id ?? 0}`;

	return {
		enter: async <Scene extends AnyScene>(
			scene: Scene,
			...args: Scene["_"]["params"] extends never
				? []
				: [params: Scene["_"]["params"]]
		) => {
			const sceneParams: ScenesStorageData<any, any> = {
				name: scene.name,
				state: {},
				params: args[0] as any,
				stepId: 0,
				previousStepId: 0,
				firstTime: true,
			};
			await storage.set(key, sceneParams);
			// @ts-expect-error
			context.scene = getInActiveSceneHandler(
				context,
				storage,
				sceneParams,
				scene,
			);
			// @ts-expect-error
			await scene.compose(context, async () => {
				const sceneData = await storage.get<ScenesStorageData<any, any>>(key);
				await storage.set(key, { ...sceneData, firstTime: false });
			});
		},
		exit: () => storage.delete(key),
	};
}

export function getInActiveSceneHandler<
	Params,
	State extends StateTypesDefault,
>(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
	sceneData: ScenesStorageData<Params, State>,
	scene: AnyScene,
) {
	const key = `@gramio/scenes:${context.from?.id ?? 0}`;

	const stepDerives = getStepDerives(context, storage, sceneData, scene);

	return {
		state: sceneData.state,
		params: sceneData.params,
		step: stepDerives,
		update: async <T extends StateTypesDefault>(
			state: T,
			options: SceneUpdateState = {
				step: sceneData.stepId + 1,
			},
		): Promise<UpdateData<T>> => {
			sceneData.state = Object.assign(sceneData.state, state);
			await storage.set(key, sceneData);

			if (options?.step !== undefined)
				await stepDerives.go(options.step, options.firstTime);

			return state;
		},
		enter: async <Scene extends AnyScene>(
			scene: Scene,
			...args: Scene["_"]["params"] extends never
				? []
				: [params: Scene["_"]["params"]]
		) => {
			const sceneParams: ScenesStorageData<Params, State> = {
				name: scene.name,
				state: {} as State,
				params: args[0] as any,
				stepId: 0,
				previousStepId: 0,
				firstTime: true,
			};
			await storage.set(key, sceneParams);
			// @ts-expect-error
			context.scene = getInActiveSceneHandler(
				context,
				storage,
				sceneParams,
				scene,
			);
			// @ts-expect-error
			await scene.compose(context, async () => {
				const sceneData =
					await storage.get<ScenesStorageData<Params, State>>(key);
				await storage.set(key, { ...sceneData, firstTime: false });
			});
		},
		exit: () => storage.delete(key),
	};
}

export function getStepDerives(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
	storageData: ScenesStorageData<any, any>,
	scene: AnyScene,
) {
	const key = `@gramio/scenes:${context.from?.id ?? 0}`;

	async function go(stepId: number, firstTime = true) {
		storageData.previousStepId = storageData.stepId;
		storageData.stepId = stepId;
		storageData.firstTime = firstTime;
		await storage.set(key, storageData);
		//@ts-expect-error
		context.scene = getInActiveSceneHandler(
			context,
			storage,
			storageData,
			scene,
		);
		// @ts-expect-error
		await scene.compose(context, async () => {
			const sceneData =
				await storage.get<ScenesStorageData<unknown, unknown>>(key);
			await storage.set(key, { ...sceneData, firstTime: false });
		});
	}

	return {
		id: storageData.stepId,
		previousId: storageData.previousStepId,
		firstTime: storageData.firstTime,
		go: go,
		next: () => go(storageData.stepId + 1),
		previous: () => go(storageData.stepId - 1),
	};
}
