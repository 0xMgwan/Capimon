import { Hero } from "@/components/Hero";
import { QuickBuy } from "@/components/QuickBuy";
import {
  StackStrip, ProductsSection, LiveBoard, StatsBand, BeliefSection, PillarsSection, ClosingCTA,
} from "@/components/HomeSections";

export default function Home() {
  return (
    <>
      {/*
       * The phone gets the short version: arrive, see it is real, buy, leave.
       * Hero, the trust strip, the ticket, what CAPX is, and the closing call —
       * about five screens.
       *
       * The four narrative sections below are the argument rather than the
       * offer, and on a phone they turned the page into thirteen swipes that
       * nobody reaches the end of. They stay in the markup and stay indexable;
       * they simply do not compete for a small screen's attention. A wider
       * screen shows the full page unchanged.
       */}
      <Hero />
      <StackStrip />
      <QuickBuy />
      <ProductsSection />

      <div className="hidden md:block">
        <LiveBoard />
        <StatsBand />
        <BeliefSection />
        <PillarsSection />
      </div>

      <ClosingCTA />
    </>
  );
}
