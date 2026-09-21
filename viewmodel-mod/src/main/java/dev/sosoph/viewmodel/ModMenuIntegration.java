package dev.sosoph.viewmodel;

import com.terraformersmc.modmenu.api.ConfigScreenFactory;
import com.terraformersmc.modmenu.api.ModMenuApi;

import dev.sosoph.viewmodel.gui.ViewModelScreen;

/** Puts the menu behind the config button in Mod Menu. */
public class ModMenuIntegration implements ModMenuApi {
    @Override
    public ConfigScreenFactory<?> getModConfigScreenFactory() {
        return ViewModelScreen::new;
    }
}
