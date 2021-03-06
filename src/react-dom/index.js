import {tag} from "../react-reconciler/FiberNode"
import {FiberNode} from "../react-reconciler/FiberNode";
import {updateContainer} from "../react-reconciler/index"


let createFiber = function (tag, type,pendingProps, key) {
    return new FiberNode(tag,type, pendingProps, key);
};

function createHostRootFiber() {
    return createFiber(tag.HostRoot, null, null, false);
}

const ReactDom = {
    render(element, container, callback) {
        const root = createHostRootFiber();
        root.stateNode = container;
        root.alternate = null;
        root.isSync = false;//首屏采用同步渲染
        updateContainer(element, root);
        return root.stateNode;
    }
};
export default ReactDom;