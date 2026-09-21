package dev.sosoph.viewmodel.gui;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;

/** A searchable snapshot of the item registry, built once and reused by every list. */
public final class ItemIndex {
    private static List<Entry> entries;

    private ItemIndex() {
    }

    public record Entry(Item item, String id, String name, String search) {
    }

    public static List<Entry> all() {
        if (entries == null) {
            List<Entry> built = new ArrayList<>();
            for (Item item : Registries.ITEM) {
                if (item == Items.AIR) {
                    continue;
                }
                String id = Registries.ITEM.getId(item).toString();
                String name = new ItemStack(item).getName().getString();
                built.add(new Entry(item, id, name, (name + " " + id).toLowerCase(Locale.ROOT)));
            }
            built.sort(Comparator.comparing(Entry::name, String.CASE_INSENSITIVE_ORDER));
            entries = List.copyOf(built);
        }
        return entries;
    }

    /** Matches on both the display name and the registry id. */
    public static List<Entry> search(String query, int limit, Comparator<Entry> order) {
        String needle = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        List<Entry> matches = new ArrayList<>();
        for (Entry entry : all()) {
            if (needle.isEmpty() || entry.search().contains(needle)) {
                matches.add(entry);
            }
        }
        if (order != null) {
            matches.sort(order);
        }
        return matches.size() > limit ? matches.subList(0, limit) : matches;
    }
}
