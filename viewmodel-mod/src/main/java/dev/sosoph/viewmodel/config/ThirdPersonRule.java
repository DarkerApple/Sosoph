package dev.sosoph.viewmodel.config;

/** One "put this item here in third person" rule. */
public class ThirdPersonRule {
    public String item = "minecraft:diamond_sword";
    public boolean enabled = true;
    public Anchor anchor = Anchor.WAIST_RIGHT;
    public Transform transform = new Transform();
    /** Snap the item back into the hand while it is being swung or used. */
    public boolean holdWhileInUse = true;

    public ThirdPersonRule() {
    }

    public ThirdPersonRule(String item, Anchor anchor, Transform transform) {
        this.item = item;
        this.anchor = anchor;
        this.transform = transform;
    }

    void validate() {
        if (this.item == null) {
            this.item = "";
        }
        if (this.anchor == null) {
            this.anchor = Anchor.HAND;
        }
        if (this.transform == null) {
            this.transform = new Transform();
        }
        this.transform.validate();
    }
}
