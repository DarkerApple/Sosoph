package dev.sosoph.viewmodel.config;

import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Loads and saves the single config instance. */
public final class ConfigManager {
    private static final Logger LOGGER = LoggerFactory.getLogger("viewmodel");
    private static final Gson GSON = new GsonBuilder()
            .setPrettyPrinting()
            .disableHtmlEscaping()
            .create();

    private static final Path PATH = FabricLoader.getInstance().getConfigDir().resolve("viewmodel.json");

    private static ViewModelConfig config = new ViewModelConfig();

    private ConfigManager() {
    }

    public static ViewModelConfig get() {
        return config;
    }

    public static void load() {
        if (!Files.exists(PATH)) {
            save();
            return;
        }
        try (Reader reader = Files.newBufferedReader(PATH)) {
            ViewModelConfig loaded = GSON.fromJson(reader, ViewModelConfig.class);
            if (loaded != null) {
                loaded.validate();
                config = loaded;
            }
        } catch (Exception e) {
            LOGGER.warn("[viewmodel] Could not read {}, falling back to defaults", PATH, e);
            config = new ViewModelConfig();
        }
    }

    public static void save() {
        try {
            Files.createDirectories(PATH.getParent());
            try (Writer writer = Files.newBufferedWriter(PATH)) {
                GSON.toJson(config, writer);
            }
        } catch (Exception e) {
            LOGGER.warn("[viewmodel] Could not write {}", PATH, e);
        }
    }

    /** Throws away every setting and writes the defaults back out. */
    public static void resetAll() {
        config = new ViewModelConfig();
        save();
    }
}
