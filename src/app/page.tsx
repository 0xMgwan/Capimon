import { Hero } from "@/components/Hero";
import { QuickBuy } from "@/components/QuickBuy";
import {
  StackStrip, ProductsSection, LiveBoard, StatsBand, BeliefSection, PillarsSection, ClosingCTA,
} from "@/components/HomeSections";

export default function Home() {
  return (
    <>
      <Hero />
      <StackStrip />
      <QuickBuy />
      <ProductsSection />
      <LiveBoard />
      <StatsBand />
      <BeliefSection />
      <PillarsSection />
      <ClosingCTA />
    </>
  );
}
