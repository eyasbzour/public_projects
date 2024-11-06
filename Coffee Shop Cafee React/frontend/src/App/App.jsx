
import React, { Component,useEffect } from 'react'
import AOS from 'aos';
import "aos/dist/aos.css"
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";

import Navbar from "../Components/Navbar/Navbar.jsx"
import Home from "../Components/Home/Home.jsx"
import Services from "../Components/Services/Services.jsx"
import Banner from "../Components/Banner/Banner.jsx"
import AppStorePromo from "../Components/AppStore/AppStorePromo.jsx"
import Testimonials from "../Components/Testimonials/Testimonials.jsx"
import Footer from "../Components/Footer/Footer.jsx"


const App = ()=>{
  useEffect(()=>{
    AOS.init(
      {
        offset:100,
        duration: 700,
        easing:'ease-in',
        delay: 100,
      }
    );
  });
  return (
    <div className='overflow-x-hidden scroll-smooth'>
      <Navbar/>
      <Home/>
      <Services/>
      <Banner/>  
      <AppStorePromo/> 
      <Testimonials/> 
      <Footer/>
    </div>
  )
}

export default App;
