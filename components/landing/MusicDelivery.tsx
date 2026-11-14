import { Fragment } from "react";
import { deliveryTypes } from "@/data/examples";

const steps = [
  { title: "기다림", body: "보낸 음악이 길을 건너는 시간." },
  { title: "도착", body: "알림이 와도, 천천히 열어도 됩니다." },
  { title: "개봉", body: "Walkie에 담고 Shop에 진열하세요." },
];

export function MusicDelivery() {
  return (
    <section className="block" id="delivery">
      <div className="wrap delivery">
        <p className="sec-kicker">Music Delivery</p>
        <h2
          style={{
            fontFamily: "var(--serif)",
            fontWeight: 400,
            fontSize: "clamp(32px, 4vw, 48px)",
          }}
        >
          음악을 보내다
        </h2>
        <p style={{ color: "var(--muted)", maxWidth: "28em", margin: "12px auto 0" }}>
          기다렸다가, 도착하고, 개봉하는 일. 음악은 그날의 우편이 됩니다.
        </p>
        <div className="ritual">
          {steps.map((step, index) => (
            <Fragment key={step.title}>
              {index > 0 ? <div className="ritual-line" aria-hidden="true" /> : null}
              <div className="ritual-step">
                <div className="ritual-dot" />
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </Fragment>
          ))}
        </div>
        <a className="btn btn-fill" href="#delivery">
          음악 보내기
        </a>
        <div className="types">
          {deliveryTypes.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
