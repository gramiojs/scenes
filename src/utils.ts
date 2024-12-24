import type { Storage } from "@gramio/storage";
import type { Bot, ContextType } from "gramio";
import type { AnyScene } from "./scene.js";
import type {
	EnterExit,
	InActiveSceneHandlerReturn,
	InUnknownScene,
	PossibleInUnknownScene,
	SceneEnterHandler,
	SceneStepReturn,
	ScenesStorageData,
	StateTypesDefault,
} from "./types.js";

function getSceneEnter(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
	key: string,
): SceneEnterHandler {
	return async (scene, ...args) => {
		const sceneParams: ScenesStorageData = {
			name: scene.name,
			state: {},
			params: args[0],
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
			const sceneData = await storage.get<ScenesStorageData>(key);
			await storage.set(key, { ...sceneData, firstTime: false });
		});
	};
}

// function isTrue(value: unknown): value is true {
// 	return value === true;
// }

export async function getSceneHandlers<WithCurrentScene extends boolean>(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
	withCurrentScene: WithCurrentScene,
	scenes: AnyScene[],
): Promise<
	WithCurrentScene extends true ? PossibleInUnknownScene<any, any> : EnterExit
> {
	const key = `@gramio/scenes:${context.from?.id ?? 0}`;

	const enterExit = {
		enter: getSceneEnter(context, storage, key),
		exit: () => storage.delete(key),
	};

	if (withCurrentScene) {
		const sceneData =
			await storage.get<ScenesStorageData<unknown, unknown>>(key);

		// TODO: fix type issues. predicates are not smart for now
		// @ts-expect-error
		if (!sceneData) return enterExit;

		const scene = scenes.find((x) => x.name === sceneData.name);
		// @ts-expect-error
		if (!scene) return enterExit;

		return getPossibleInSceneHandlers(context, storage, sceneData, scene, key);
	}

	// @ts-expect-error
	return enterExit;
}

export function getInActiveSceneHandler<
	Params,
	State extends StateTypesDefault,
>(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
	sceneData: ScenesStorageData<Params, State>,
	scene: AnyScene,
): InActiveSceneHandlerReturn<Params, State> {
	const key = `@gramio/scenes:${context.from?.id ?? 0}`;

	const stepDerives = getStepDerives(context, storage, sceneData, scene);

	return {
		state: sceneData.state,
		params: sceneData.params,
		step: stepDerives,
		update: async (
			state,
			options = {
				step: sceneData.stepId + 1,
			},
		) => {
			sceneData.state = Object.assign(sceneData.state, state);
			await storage.set(key, sceneData);

			if (options?.step !== undefined)
				await stepDerives.go(options.step, options.firstTime);

			return state;
		},
		enter: getSceneEnter(context, storage, key),
		exit: () => storage.delete(key),
	};
}

export function getStepDerives(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
	storageData: ScenesStorageData<any, any>,
	scene: AnyScene,
): SceneStepReturn {
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

export function getInUnknownScene<Params, State extends StateTypesDefault>(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
	sceneData: ScenesStorageData<Params, State>,
	scene: AnyScene,
): InUnknownScene<Params, State> {
	return {
		...getInActiveSceneHandler(context, storage, sceneData, scene),
		// @ts-expect-error
		is: (scene) => scene.name === sceneData.name,
	};
}

export function getPossibleInSceneHandlers<
	Params,
	State extends StateTypesDefault,
>(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
	sceneData: ScenesStorageData<Params, State>,
	scene: AnyScene,
	key: string,
): PossibleInUnknownScene<Params, State> {
	return {
		current: getInUnknownScene(context, storage, sceneData, scene),
		enter: getSceneEnter(context, storage, key),
		exit: () => storage.delete(key),
	};
}
