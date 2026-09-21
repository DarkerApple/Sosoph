package dev.sosoph.viewmodel.gui;

import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.world.item.ItemStack;

/**
 * The handful of 26.3 calls that are easiest to get wrong, kept in one place.
 *
 * <p>Minecraft 26.x replaced immediate mode GUI drawing with the extract pipeline and
 * turned input into event objects. Everything else in this package was checked against
 * Fabric API and Mod Menu sources for 26.3; these few could not be, so if the compiler
 * disagrees with something, it is almost certainly in here and nowhere else.
 */
public final class Compat {
    public static final int MOUSE_LEFT = 0;
    public static final int MOUSE_RIGHT = 1;

    private Compat() {
    }

    // -- input -------------------------------------------------------------

    public static boolean isLeftClick(MouseButtonEvent event) {
        return event.button() == MOUSE_LEFT;
    }

    public static boolean isRightClick(MouseButtonEvent event) {
        return event.button() == MOUSE_RIGHT;
    }

    public static double mouseX(MouseButtonEvent event) {
        return event.x();
    }

    public static double mouseY(MouseButtonEvent event) {
        return event.y();
    }

    // -- drawing -----------------------------------------------------------

    /** A one pixel outline, drawn as four fills so no border helper is needed. */
    public static void border(GuiGraphicsExtractor graphics, int x, int y, int width, int height, int color) {
        graphics.fill(x, y, x + width, y + 1, color);
        graphics.fill(x, y + height - 1, x + width, y + height, color);
        graphics.fill(x, y + 1, x + 1, y + height - 1, color);
        graphics.fill(x + width - 1, y + 1, x + width, y + height - 1, color);
    }

    /** Draws a 16x16 item icon. */
    public static void item(GuiGraphicsExtractor graphics, ItemStack stack, int x, int y) {
        graphics.item(stack, x, y);
    }

    /** Cuts a string down to a pixel width. */
    public static String trim(Font font, String text, int width) {
        return font.plainSubstrByWidth(text, Math.max(0, width));
    }

    /** Cuts a string down and appends an ellipsis when it did not fit. */
    public static String trimWithEllipsis(Font font, String text, int width) {
        if (font.width(text) <= width) {
            return text;
        }
        return trim(font, text, Math.max(0, width - font.width("..."))) + "...";
    }
}
