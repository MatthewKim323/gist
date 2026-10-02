// Renderer `matter`: the page is empty DOM over the case menu backdrop scene. On a direct load there is
// no wipe, so the backdrop is switched on here once assets are in.
import { store } from "../../core/store";
import { BaseRenderer } from "./base";

export class MatterRenderer extends BaseRenderer {
  onFirstLoad() {
    super.onFirstLoad();
    (store.AssetLoader!.loaded as Promise<void>).then(() => {
      const menu = store.CaseMenu;
      menu.firstLoad = true;
      menu.build(true);
      menu.allowControl = true;
      store.Gl!.globalUniforms.fogColor.value.copy(menu.scene.fog.color);
      store.Gl!.globalUniforms.fogNear.value = menu.scene.fog.near;
      store.Gl!.globalUniforms.fogFar.value = menu.scene.fog.far;
      store.HomeContact.renderPass.enabled = false;
      store.PageLoader.hide();
    });
  }
}

export default MatterRenderer;
