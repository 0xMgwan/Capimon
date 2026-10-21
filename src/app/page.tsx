import { Hero } from "@/components/Hero";
import { HomeGate } from "@/components/HomeGate";
import { SandboxNotice } from "@/components/SandboxNotice";
import {
  StackStrip, DseSection, ProductsSection, AutoInvestBand, LiveBoard, StatsBand, BeliefSection, PillarsSection, ClosingCTA,
} from "@/components/HomeSections";

export default function Home() {
  return (
    <HomeGate>
      {/*
       * Said before anything else, because it changes what the rest of the
       * page means: both CAPX and nTZS operate under sandbox authorisations,
       * and somebody deciding whether to put money in should know that while
       * they are deciding rather than afterwards.
       */}
      <SandboxNotice />

      {/*
       * The phone gets the short version: arrive, see it is real, buy, leave.
       * The ticket is inside the hero now, so buying is the first screen
       * rather than the third.
       *
       * The four narrative sections below are the argument rather than the
       * offer, and on a phone they turned the page into thirteen swipes that
       * nobody reaches the end of. They stay in the markup and stay indexable;
       * they simply do not compete for a small screen's attention. A wider
       * screen shows the full page unchanged.
       */}
      <Hero />
      <StackStrip />
      <DseSection />
      <ProductsSection />
      <AutoInvestBand />

      <div className="hidden md:block">
        <LiveBoard />
        <StatsBand />
        <BeliefSection />
        <PillarsSection />
      </div>

      <ClosingCTA />
    </HomeGate>
  );
}
