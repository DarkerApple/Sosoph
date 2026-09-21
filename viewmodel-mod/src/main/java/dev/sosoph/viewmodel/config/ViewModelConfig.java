package dev.sosoph.viewmodel.config;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;

/** Everything the mod remembers. Serialized to {@code config/viewmodel.json}. */
public class ViewModelConfig {
    public boolean enabled = true;

    // First person view models.
    public Transform mainHand = new Transform();
    public Transform offHand = new Transform();

    // Animation.
    public float swingSpeed = 1.0F;
    public float swingAmount = 1.0F;

    // Third person item placement.
    public boolean thirdPersonEnabled = true;
    public List<ThirdPersonRule> rules = new ArrayList<>();

    // Items the mod leaves completely alone.
    public List<String> blacklist = new ArrayList<>(List.of("minecraft:filled_map", "minecraft:spyglass"));

    private transient Set<String> blacklistCache;
    private transient Map<String, ThirdPersonRule> ruleCache;

    public static final float SWING_SPEED_MIN = 0.25F;
    public static final float SWING_SPEED_MAX = 4.0F;
    public static final float SWING_AMOUNT_MIN = 0.0F;
    public static final float SWING_AMOUNT_MAX = 1.5F;

    public Transform handTransform(boolean mainHand) {
        return mainHand ? this.mainHand : this.offHand;
    }

    // -- blacklist ---------------------------------------------------------

    public boolean isBlacklisted(ItemStack stack) {
        return !stack.isEmpty() && this.isBlacklisted(stack.getItem());
    }

    public boolean isBlacklisted(Item item) {
        return this.isBlacklisted(idOf(item));
    }

    public boolean isBlacklisted(String id) {
        if (this.blacklistCache == null) {
            this.blacklistCache = new HashSet<>(this.blacklist);
        }
        return this.blacklistCache.contains(id);
    }

    public void setBlacklisted(String id, boolean blacklisted) {
        if (blacklisted) {
            if (!this.blacklist.contains(id)) {
                this.blacklist.add(id);
            }
        } else {
            this.blacklist.remove(id);
        }
        this.blacklistCache = null;
    }

    public void toggleBlacklisted(String id) {
        this.setBlacklisted(id, !this.isBlacklisted(id));
    }

    // -- third person rules ------------------------------------------------

    /** The rule that should place this stack, or null when it renders normally. */
    public ThirdPersonRule ruleFor(ItemStack stack) {
        if (!this.thirdPersonEnabled || stack.isEmpty()) {
            return null;
        }
        String id = idOf(stack.getItem());
        if (this.isBlacklisted(id)) {
            return null;
        }
        if (this.ruleCache == null) {
            Map<String, ThirdPersonRule> cache = new HashMap<>();
            for (ThirdPersonRule rule : this.rules) {
                if (rule != null && rule.enabled && rule.item != null && !rule.item.isEmpty()) {
                    cache.putIfAbsent(rule.item, rule);
                }
            }
            this.ruleCache = cache;
        }
        return this.ruleCache.get(id);
    }

    public void addRule(ThirdPersonRule rule) {
        this.rules.add(rule);
        this.invalidate();
    }

    public void removeRule(ThirdPersonRule rule) {
        this.rules.remove(rule);
        this.invalidate();
    }

    public boolean hasRuleFor(String id) {
        for (ThirdPersonRule rule : this.rules) {
            if (rule != null && id.equals(rule.item)) {
                return true;
            }
        }
        return false;
    }

    /** Call after editing rules so the lookup cache is rebuilt. */
    public void invalidate() {
        this.ruleCache = null;
        this.blacklistCache = null;
    }

    // -- housekeeping ------------------------------------------------------

    public static String idOf(Item item) {
        return Registries.ITEM.getId(item).toString();
    }

    /** The item for a saved id, or null when that id is not in this game's registry. */
    public static Item itemOf(String id) {
        Identifier identifier = Identifier.tryParse(id);
        if (identifier == null) {
            return null;
        }
        Item item = Registries.ITEM.get(identifier);
        return item == Items.AIR && !"minecraft:air".equals(id) ? null : item;
    }

    /** Repairs anything a hand edited config file (or an old version) got wrong. */
    public void validate() {
        if (this.mainHand == null) {
            this.mainHand = new Transform();
        }
        if (this.offHand == null) {
            this.offHand = new Transform();
        }
        this.mainHand.validate();
        this.offHand.validate();

        this.swingSpeed = clamp(this.swingSpeed, SWING_SPEED_MIN, SWING_SPEED_MAX, 1.0F);
        this.swingAmount = clamp(this.swingAmount, SWING_AMOUNT_MIN, SWING_AMOUNT_MAX, 1.0F);

        if (this.rules == null) {
            this.rules = new ArrayList<>();
        }
        this.rules.removeIf(rule -> rule == null);
        for (ThirdPersonRule rule : this.rules) {
            rule.validate();
        }

        if (this.blacklist == null) {
            this.blacklist = new ArrayList<>();
        }
        this.blacklist.removeIf(id -> id == null || id.isEmpty());

        this.invalidate();
    }

    private static float clamp(float value, float min, float max, float fallback) {
        if (Float.isNaN(value)) {
            return fallback;
        }
        return Math.max(min, Math.min(max, value));
    }
}
